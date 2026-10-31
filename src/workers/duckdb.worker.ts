/**
 * Worker DuckDB-WASM dédié (Phase 2).
 *
 * Héberge une instance AsyncDuckDB (bundle MVP) dans ce worker RPC :
 * le thread principal ne fait que poster des messages typés
 * (init / queryMetrics / getCommuneHistory).
 *
 * Les fichiers Parquet Phase 1 sont enregistrés via
 * `registerFileURL(..., DuckDBDataProtocol.HTTP, ...)` : DuckDB-WASM
 * les lit par HTTP Range Requests, sans téléchargement complet.
 * Ne jamais utiliser la colonne virtuelle `filename` en hive partitioning :
 * chaque requête cible directement un chemin de partition.
 */
import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorkerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import {
  INDICATORS,
  SCENARIOS,
  isIndicator,
  isScenario,
  metricsParquetPath,
  type CommuneHistoryRow,
  type CommuneProfile,
  type Indicator,
  type Scenario,
  type WorkerRequest,
  type WorkerResponse,
} from '../lib/metricsTypes';

interface DuckDBState {
  db: duckdb.AsyncDuckDB;
  conn: duckdb.AsyncDuckDBConnection;
  origin: string;
  registered: Set<string>;
}

let state: DuckDBState | null = null;
let initPromise: Promise<DuckDBState> | null = null;

function post(response: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, { transfer });
}

function virtualName(scenario: Scenario, indicator: Indicator): string {
  return `${scenario}__${indicator}.parquet`;
}

async function ensureFile(st: DuckDBState, scenario: Scenario, indicator: Indicator): Promise<string> {
  const name = virtualName(scenario, indicator);
  if (!st.registered.has(name)) {
    const url = `${st.origin}${metricsParquetPath(scenario, indicator)}`;
    await st.db.registerFileURL(name, url, duckdb.DuckDBDataProtocol.HTTP, false);
    st.registered.add(name);
  }
  return name;
}

async function init(origin: string): Promise<DuckDBState> {
  if (state) return state;
  if (initPromise) return initPromise;
  initPromise = (async (): Promise<DuckDBState> => {
    const bundles: duckdb.DuckDBBundles = {
      mvp: { mainModule: mvpWasmUrl, mainWorker: mvpWorkerUrl },
    };
    const bundle = await duckdb.selectBundle(bundles);
    if (!bundle.mainWorker) throw new Error('Bundle DuckDB MVP sans worker');
    // Worker interne DuckDB (imbriqué dans ce worker RPC).
    const innerWorker = new Worker(bundle.mainWorker);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const db = new duckdb.AsyncDuckDB(logger, innerWorker);
    await db.instantiate(bundle.mainModule);
    const conn = await db.connect();
    // HTTPFS est intégré au runtime WASM via DuckDBDataProtocol.HTTP ;
    // la tentative de LOAD reste tolérante (extension distante inutile ici).
    try {
      await conn.query('LOAD httpfs;');
    } catch {
      // Range Requests assurées par registerFileURL — pas bloquant.
    }
    state = { db, conn, origin, registered: new Set<string>() };
    return state;
  })();
  return initPromise;
}

type ArrowTable = Awaited<ReturnType<duckdb.AsyncDuckDBConnection['query']>>;

function columnStrings(table: ArrowTable, name: string): string[] {
  const col = table.getChild(name);
  if (!col) throw new Error(`Colonne absente du résultat: ${name}`);
  const out: string[] = new Array<string>(table.numRows);
  for (let i = 0; i < table.numRows; i += 1) {
    const v: unknown = col.get(i);
    out[i] = typeof v === 'string' ? v : String(v ?? '');
  }
  return out;
}

function columnFloats(table: ArrowTable, name: string): Float32Array {
  const col = table.getChild(name);
  if (!col) throw new Error(`Colonne absente du résultat: ${name}`);
  const out = new Float32Array(table.numRows);
  for (let i = 0; i < table.numRows; i += 1) {
    const v: unknown = col.get(i);
    out[i] = typeof v === 'number' ? v : Number(v ?? 0);
  }
  return out;
}

function columnInts(table: ArrowTable, name: string): Int32Array {
  const floats = columnFloats(table, name);
  return Int32Array.from(floats);
}

async function queryMetrics(
  st: DuckDBState,
  scenario: Scenario,
  indicator: Indicator,
  year: number,
): Promise<{ codes: string[]; composite: Float32Array; hazard: Float32Array }> {
  const file = await ensureFile(st, scenario, indicator);
  // Chemin direct de partition — pas de hive `filename` (note Phase 1).
  const table = await st.conn.query(
    `SELECT code_insee, composite_risk_score, hazard_local_100m
     FROM read_parquet('${file}')
     WHERE year = ${year}`,
  );
  return {
    codes: columnStrings(table, 'code_insee'),
    composite: columnFloats(table, 'composite_risk_score'),
    hazard: columnFloats(table, 'hazard_local_100m'),
  };
}

async function getCommuneHistory(st: DuckDBState, codeInsee: string): Promise<CommuneHistoryRow[]> {
  if (!/^[0-9A-Za-z]{1,5}$/.test(codeInsee)) {
    throw new Error(`code_insee invalide: ${codeInsee}`);
  }
  const parts: string[] = [];
  for (const scenario of SCENARIOS) {
    for (const indicator of INDICATORS) {
      const file = await ensureFile(st, scenario, indicator);
      parts.push(
        `SELECT '${scenario}' AS scenario, '${indicator}' AS indicator, year,
                hazard_raw, hazard_local_100m, exposure_score, vulnerability_score, composite_risk_score
         FROM read_parquet('${file}') WHERE code_insee = '${codeInsee}'`,
      );
    }
  }
  const table = await st.conn.query(`${parts.join('\nUNION ALL\n')}\nORDER BY scenario, indicator, year`);
  const scenarios = columnStrings(table, 'scenario');
  const indicators = columnStrings(table, 'indicator');
  const years = columnInts(table, 'year');
  const hazardRaw = columnFloats(table, 'hazard_raw');
  const hazardLocal = columnFloats(table, 'hazard_local_100m');
  const exposure = columnFloats(table, 'exposure_score');
  const vulnerability = columnFloats(table, 'vulnerability_score');
  const composite = columnFloats(table, 'composite_risk_score');
  const rows: CommuneHistoryRow[] = [];
  for (let i = 0; i < table.numRows; i += 1) {
    const scenario = scenarios[i] ?? '';
    const indicator = indicators[i] ?? '';
    if (!isScenario(scenario) || !isIndicator(indicator)) continue;
    rows.push({
      scenario,
      indicator,
      year: years[i] ?? 0,
      hazardRaw: hazardRaw[i] ?? 0,
      hazardLocal: hazardLocal[i] ?? 0,
      exposure: exposure[i] ?? 0,
      vulnerability: vulnerability[i] ?? 0,
      composite: composite[i] ?? 0,
    });
  }
  return rows;
}

async function getCommuneProfile(st: DuckDBState, codeInsee: string): Promise<CommuneProfile | null> {
  if (!/^[0-9A-Za-z]{1,5}$/.test(codeInsee)) {
    throw new Error(`code_insee invalide: ${codeInsee}`);
  }
  const name = 'communes_reference.parquet';
  if (!st.registered.has(name)) {
    await st.db.registerFileURL(
      name,
      `${st.origin}/data/communes_reference.parquet`,
      duckdb.DuckDBDataProtocol.HTTP,
      false,
    );
    st.registered.add(name);
  }
  const table = await st.conn.query(
    `SELECT code_insee, nom, dept, lon, lat, exposure_score, vulnerability_score
     FROM read_parquet('${name}') WHERE code_insee = '${codeInsee}' LIMIT 1`,
  );
  if (table.numRows === 0) return null;
  return {
    codeInsee: columnStrings(table, 'code_insee')[0] ?? codeInsee,
    nom: columnStrings(table, 'nom')[0] ?? codeInsee,
    dept: columnStrings(table, 'dept')[0] ?? '',
    lon: columnFloats(table, 'lon')[0] ?? 0,
    lat: columnFloats(table, 'lat')[0] ?? 0,
    exposure: columnFloats(table, 'exposure_score')[0] ?? 0,
    vulnerability: columnFloats(table, 'vulnerability_score')[0] ?? 0,
  };
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const request = event.data;
  void (async (): Promise<void> => {
    const started = performance.now();
    try {
      if (request.type === 'init') {
        await init(request.payload.origin);
        post({ id: request.id, ok: true, type: 'init', elapsedMs: performance.now() - started });
        return;
      }
      const st = await init(self.location.origin);
      if (request.type === 'queryMetrics') {
        const { scenario, indicator, year } = request.payload;
        if (!isScenario(scenario) || !isIndicator(indicator) || !Number.isInteger(year)) {
          throw new Error(`Paramètres queryMetrics invalides: ${scenario}/${indicator}/${year}`);
        }
        const result = await queryMetrics(st, scenario, indicator, year);
        post(
          {
            id: request.id,
            ok: true,
            type: 'queryMetrics',
            codes: result.codes,
            composite: result.composite,
            hazard: result.hazard,
            elapsedMs: performance.now() - started,
          },
          [result.composite.buffer, result.hazard.buffer],
        );
        return;
      }
      if (request.type === 'getCommuneProfile') {
        const profile = await getCommuneProfile(st, request.payload.codeInsee);
        post({ id: request.id, ok: true, type: 'getCommuneProfile', profile, elapsedMs: performance.now() - started });
        return;
      }
      const rows = await getCommuneHistory(st, request.payload.codeInsee);
      post({ id: request.id, ok: true, type: 'getCommuneHistory', rows, elapsedMs: performance.now() - started });
    } catch (err: unknown) {
      post({ id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
};
