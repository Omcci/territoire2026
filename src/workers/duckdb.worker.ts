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
import { completeMetrics, resolveMetricCode } from '../lib/metricsCoverage';
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
    if (!bundle.mainWorker) throw new Error('DuckDB MVP bundle missing worker');
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
  if (!col) throw new Error(`Column missing from result: ${name}`);
  const out: string[] = new Array<string>(table.numRows);
  for (let i = 0; i < table.numRows; i += 1) {
    const v: unknown = col.get(i);
    out[i] = typeof v === 'string' ? v : String(v ?? '');
  }
  return out;
}

function columnFloats(table: ArrowTable, name: string): Float32Array {
  const col = table.getChild(name);
  if (!col) throw new Error(`Column missing from result: ${name}`);
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

interface GeoJsonCommuneFeature {
  properties?: { code_insee?: unknown } | null;
}

let realCommuneCodesPromise: Promise<string[]> | null = null;

/** Liste des codes des vraies communes (géographie Etalab), chargée une fois. */
function loadRealCommuneCodes(origin: string): Promise<string[]> {
  if (!realCommuneCodesPromise) {
    realCommuneCodesPromise = (async (): Promise<string[]> => {
      try {
        const res = await fetch(`${origin}/data/geo/communes.geojson`);
        if (!res.ok) return [];
        const data = (await res.json()) as { features?: GeoJsonCommuneFeature[] };
        const codes: string[] = [];
        for (const feature of data.features ?? []) {
          const code = feature.properties?.code_insee;
          if (typeof code === 'string') codes.push(code);
        }
        return codes;
      } catch {
        return []; // la propagation grandes villes reste active sans la liste
      }
    })();
  }
  return realCommuneCodesPromise;
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
  const rawCodes = columnStrings(table, 'code_insee');
  const rawComposite = columnFloats(table, 'composite_risk_score');
  const rawHazard = columnFloats(table, 'hazard_local_100m');
  const metrics = new Map<string, { composite: number; hazard: number }>();
  for (let i = 0; i < rawCodes.length; i += 1) {
    const code = rawCodes[i];
    if (code) metrics.set(code, { composite: rawComposite[i] ?? 0, hazard: rawHazard[i] ?? 0 });
  }
  // Zéro trou : arrondissements Paris/Lyon/Marseille + repli départemental.
  const allCodes = await loadRealCommuneCodes(st.origin);
  const completed = completeMetrics(metrics, allCodes, indicator === 'prix_immo' || indicator === 'cher_expose' || indicator === 'voiture_menages' || indicator === 'voiture_travail' || indicator === 'transports_communs' || indicator === 'fragilites');
  const codes = [...completed.keys()];
  const composite = new Float32Array(codes.length);
  const hazard = new Float32Array(codes.length);
  codes.forEach((code, i) => {
    const point = completed.get(code);
    composite[i] = point?.composite ?? 0;
    hazard[i] = point?.hazard ?? 0;
  });
  return { codes, composite, hazard };
}

/**
 * Historique de repli : moyennes du département (ou nationales si le
 * département est absent des données). Garantit qu'aucune commune —
 * Paris comprise — n'affiche « Risque non évalué ».
 */
async function getHistoryFallback(st: DuckDBState, codeInsee: string): Promise<CommuneHistoryRow[]> {
  const reference = await ensureReference(st);
  const dept = codeInsee.slice(0, 2).replace(/'/g, '');
  const rows: CommuneHistoryRow[] = [];
  for (const scenario of SCENARIOS) {
    for (const indicator of INDICATORS) {
      // Indicateurs prix observés : jamais de repli par moyenne (audit D.1/D.2).
      // Une commune absente des Parquet reçoit la sentinelle « non établi »,
      // pour que la fiche affiche « Non évalué » au lieu d'un prix estimé.
      if (indicator === 'prix_immo' || indicator === 'cher_expose' || indicator === 'voiture_menages' || indicator === 'voiture_travail' || indicator === 'transports_communs' || indicator === 'fragilites') {
        for (const year of [1990, 2025, 2050, 2100]) {
          rows.push({
            scenario, indicator, year,
            hazardRaw: 0, hazardLocal: 0, exposure: -1, vulnerability: 0, composite: -1,
          });
        }
        continue;
      }
      const file = await ensureFile(st, scenario, indicator);
      const deptFilter = `JOIN read_parquet('${reference}') r ON r.code_insee = m.code_insee WHERE r.dept = '${dept}' AND m.composite_risk_score >= 0`;
      let table = await st.conn.query(
        `SELECT m.year AS year, AVG(m.hazard_raw) AS hazard_raw, AVG(m.hazard_local_100m) AS hazard_local_100m,
                AVG(m.exposure_score) AS exposure_score, AVG(m.vulnerability_score) AS vulnerability_score,
                AVG(m.composite_risk_score) AS composite_risk_score
         FROM read_parquet('${file}') m ${deptFilter} GROUP BY m.year ORDER BY m.year`,
      );
      if (table.numRows === 0) {
        table = await st.conn.query(
          `SELECT year, AVG(hazard_raw) AS hazard_raw, AVG(hazard_local_100m) AS hazard_local_100m,
                  AVG(exposure_score) AS exposure_score, AVG(vulnerability_score) AS vulnerability_score,
                  AVG(composite_risk_score) AS composite_risk_score
           FROM read_parquet('${file}') WHERE composite_risk_score >= 0 GROUP BY year ORDER BY year`,
        );
      }
      const years = columnInts(table, 'year');
      const hazardRaw = columnFloats(table, 'hazard_raw');
      const hazardLocal = columnFloats(table, 'hazard_local_100m');
      const exposure = columnFloats(table, 'exposure_score');
      const vulnerability = columnFloats(table, 'vulnerability_score');
      const composite = columnFloats(table, 'composite_risk_score');
      for (let i = 0; i < table.numRows; i += 1) {
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
    }
  }
  return rows;
}

async function getCommuneHistory(st: DuckDBState, codeInsee: string): Promise<CommuneHistoryRow[]> {
  if (!/^[0-9A-Za-z]{1,5}$/.test(codeInsee)) {
    throw new Error(`Invalid INSEE code: ${codeInsee}`);
  }
  // Alias grandes villes : 751xx -> 75056, 132xx -> 13055, 693xx -> 69123.
  const metricCode = resolveMetricCode(codeInsee);
  const parts: string[] = [];
  for (const scenario of SCENARIOS) {
    for (const indicator of INDICATORS) {
      const file = await ensureFile(st, scenario, indicator);
      parts.push(
        `SELECT '${scenario}' AS scenario, '${indicator}' AS indicator, year,
                hazard_raw, hazard_local_100m, exposure_score, vulnerability_score, composite_risk_score
         FROM read_parquet('${file}') WHERE code_insee = '${metricCode}'`,
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
  // Aucune ligne pour ce code : repli départemental systématique.
  if (rows.length === 0) return getHistoryFallback(st, codeInsee);
  return rows;
}

const REFERENCE_FILE = 'communes_reference.parquet';

async function ensureReference(st: DuckDBState): Promise<string> {
  if (!st.registered.has(REFERENCE_FILE)) {
    await st.db.registerFileURL(
      REFERENCE_FILE,
      `${st.origin}/data/communes_reference.parquet`,
      duckdb.DuckDBDataProtocol.HTTP,
      false,
    );
    st.registered.add(REFERENCE_FILE);
  }
  return REFERENCE_FILE;
}

/** Agrégation nationale : risque moyen par département (96 lignes). */
async function getDepartementMetrics(
  st: DuckDBState,
  scenario: Scenario,
  indicator: Indicator,
  year: number,
): Promise<{ codes: string[]; composite: Float32Array; hazard: Float32Array }> {
  const metricsFile = await ensureFile(st, scenario, indicator);
  const reference = await ensureReference(st);
  const table = await st.conn.query(
    `SELECT r.dept AS dept,
            AVG(m.composite_risk_score) AS composite_risk_score,
            AVG(m.hazard_local_100m) AS hazard_local_100m
     FROM read_parquet('${metricsFile}') m
     JOIN read_parquet('${reference}') r ON r.code_insee = m.code_insee
     WHERE m.year = ${year} AND m.composite_risk_score >= 0
     GROUP BY r.dept`,
  );
  const codes = columnStrings(table, 'dept');
  const composite = columnFloats(table, 'composite_risk_score');
  const hazard = columnFloats(table, 'hazard_local_100m');
  if (indicator === 'prix_immo' || indicator === 'cher_expose' || indicator === 'voiture_menages' || indicator === 'voiture_travail' || indicator === 'transports_communs' || indicator === 'fragilites') {
    // Tout département absent des moyennes (aucune commune fiable, p. ex.
    // l'Alsace hors DVF) est émis en « non établi » (-1), pas en valeur claire.
    const deptTable = await st.conn.query(
      `SELECT DISTINCT dept FROM read_parquet('${reference}') ORDER BY dept`,
    );
    const present = new Set(codes);
    const allDepts = columnStrings(deptTable, 'dept');
    const extraCodes: string[] = [];
    const extraComposite: number[] = [];
    const extraHazard: number[] = [];
    for (const dept of allDepts) {
      if (!present.has(dept)) {
        extraCodes.push(dept);
        extraComposite.push(-1);
        extraHazard.push(0);
      }
    }
    if (extraCodes.length > 0) {
      return {
        codes: [...codes, ...extraCodes],
        composite: new Float32Array([...composite, ...extraComposite]),
        hazard: new Float32Array([...hazard, ...extraHazard]),
      };
    }
  }
  return { codes, composite, hazard };
}

async function getCommuneProfile(st: DuckDBState, codeInsee: string): Promise<CommuneProfile | null> {
  if (!/^[0-9A-Za-z]{1,5}$/.test(codeInsee)) {
    throw new Error(`Invalid INSEE code: ${codeInsee}`);
  }
  const name = await ensureReference(st);
  const metricCode = resolveMetricCode(codeInsee);
  const table = await st.conn.query(
    `SELECT code_insee, nom, dept, lon, lat, exposure_score, vulnerability_score
     FROM read_parquet('${name}') WHERE code_insee = '${metricCode}' LIMIT 1`,
  );
  if (table.numRows > 0) {
    return {
      codeInsee: columnStrings(table, 'code_insee')[0] ?? metricCode,
      nom: columnStrings(table, 'nom')[0] ?? codeInsee,
      dept: columnStrings(table, 'dept')[0] ?? '',
      lon: columnFloats(table, 'lon')[0] ?? 0,
      lat: columnFloats(table, 'lat')[0] ?? 0,
      exposure: columnFloats(table, 'exposure_score')[0] ?? 0,
      vulnerability: columnFloats(table, 'vulnerability_score')[0] ?? 0,
    };
  }
  // Repli : profil synthétique = centroïde et moyennes du département.
  const dept = codeInsee.slice(0, 2).replace(/'/g, '');
  const deptTable = await st.conn.query(
    `SELECT dept, AVG(lon) AS lon, AVG(lat) AS lat,
            AVG(exposure_score) AS exposure_score, AVG(vulnerability_score) AS vulnerability_score
     FROM read_parquet('${name}') WHERE dept = '${dept}' GROUP BY dept`,
  );
  if (deptTable.numRows === 0) return null;
  return {
    codeInsee,
    nom: codeInsee,
    dept: columnStrings(deptTable, 'dept')[0] ?? dept,
    lon: columnFloats(deptTable, 'lon')[0] ?? 0,
    lat: columnFloats(deptTable, 'lat')[0] ?? 0,
    exposure: columnFloats(deptTable, 'exposure_score')[0] ?? 0,
    vulnerability: columnFloats(deptTable, 'vulnerability_score')[0] ?? 0,
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
          throw new Error(`Invalid queryMetrics parameters: ${scenario}/${indicator}/${year}`);
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
      if (request.type === 'getDepartementMetrics') {
        const { scenario: deptScenario, indicator: deptIndicator, year: deptYear } = request.payload;
        if (!isScenario(deptScenario) || !isIndicator(deptIndicator) || !Number.isInteger(deptYear)) {
          throw new Error('Invalid getDepartementMetrics parameters');
        }
        const dept = await getDepartementMetrics(st, deptScenario, deptIndicator, deptYear);
        post(
          {
            id: request.id,
            ok: true,
            type: 'getDepartementMetrics',
            codes: dept.codes,
            composite: dept.composite,
            hazard: dept.hazard,
            elapsedMs: performance.now() - started,
          },
          [dept.composite.buffer, dept.hazard.buffer],
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
