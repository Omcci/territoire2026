/** Contrats partagés Phase 2 — alignés sur le schéma Gold Phase 1 (voir data/metrics/_metadata.json). */

export type Scenario = 'ssp126' | 'ssp245' | 'ssp585';
export type Indicator = 'heatwave' | 'rga' | 'flooding' | 'water_stress';
export type AppMode = 'STORY' | 'EXPLORE';

export const SCENARIOS: readonly Scenario[] = ['ssp126', 'ssp245', 'ssp585'];
export const INDICATORS: readonly Indicator[] = ['heatwave', 'rga', 'flooding', 'water_stress'];
export const PIVOT_YEARS: readonly number[] = [1990, 2025, 2050, 2100];

export const SCENARIO_LABELS: Record<Scenario, string> = {
  ssp126: 'SSP1-2.6',
  ssp245: 'SSP2-4.5',
  ssp585: 'SSP5-8.5',
};

export const INDICATOR_LABELS: Record<Indicator, string> = {
  heatwave: 'Canicules',
  rga: 'Argiles / RGA',
  flooding: 'Inondations',
  water_stress: 'Sécheresse',
};

export interface MetricPoint {
  composite: number;
  hazard: number;
}

export interface CommuneHistoryRow {
  scenario: Scenario;
  indicator: Indicator;
  year: number;
  hazardRaw: number;
  hazardLocal: number;
  exposure: number;
  vulnerability: number;
  composite: number;
}

export type MetricsMap = Map<string, MetricPoint>;

/** Profil statique d'une commune (data/geo/communes_reference.parquet, Phase 1). */
export interface CommuneProfile {
  codeInsee: string;
  nom: string;
  dept: string;
  lon: number;
  lat: number;
  exposure: number;
  vulnerability: number;
}

/* ---- Protocole RPC du worker DuckDB ---- */

export type WorkerRequest =
  | { id: number; type: 'init'; payload: { origin: string } }
  | { id: number; type: 'queryMetrics'; payload: { scenario: Scenario; indicator: Indicator; year: number } }
  | { id: number; type: 'getCommuneHistory'; payload: { codeInsee: string } }
  | { id: number; type: 'getCommuneProfile'; payload: { codeInsee: string } };

export type WorkerResponse =
  | { id: number; ok: true; type: 'init'; elapsedMs: number }
  | {
      id: number;
      ok: true;
      type: 'queryMetrics';
      codes: string[];
      composite: Float32Array;
      hazard: Float32Array;
      elapsedMs: number;
    }
  | { id: number; ok: true; type: 'getCommuneHistory'; rows: CommuneHistoryRow[]; elapsedMs: number }
  | { id: number; ok: true; type: 'getCommuneProfile'; profile: CommuneProfile | null; elapsedMs: number }
  | { id: number; ok: false; error: string };

export function isScenario(value: string): value is Scenario {
  return (SCENARIOS as readonly string[]).includes(value);
}

export function isIndicator(value: string): value is Indicator {
  return (INDICATORS as readonly string[]).includes(value);
}

export function metricsParquetPath(scenario: Scenario, indicator: Indicator): string {
  return `/data/metrics/scenario=${scenario}/indicator=${indicator}.parquet`;
}
