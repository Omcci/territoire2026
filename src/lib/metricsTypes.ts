/** Contrats partagés Phase 2 — alignés sur le schéma Gold Phase 1 (voir data/metrics/_metadata.json). */

export type Scenario = 'ssp126' | 'ssp245' | 'ssp585';
export type Indicator = 'heatwave' | 'rga' | 'flooding' | 'water_stress' | 'catnat' | 'prix_immo' | 'cher_expose' | 'services' | 'voiture_menages' | 'voiture_travail' | 'transports_communs' | 'fragilites';
export type AppMode = 'STORY' | 'EXPLORE';

export const SCENARIOS: readonly Scenario[] = ['ssp126', 'ssp245', 'ssp585'];
export const INDICATORS: readonly Indicator[] = ['heatwave', 'rga', 'flooding', 'water_stress', 'catnat', 'prix_immo', 'cher_expose', 'services', 'voiture_menages', 'voiture_travail', 'transports_communs', 'fragilites'];
export const PIVOT_YEARS: readonly number[] = [1990, 2025, 2050, 2100];

export const SCENARIO_LABELS: Record<Scenario, string> = {
  ssp126: 'Low-emissions pathway (+1.5°C)',
  ssp245: 'Middle-of-the-road pathway (+2.7°C)',
  ssp585: 'High-emissions pathway (+4.0°C)',
};

export const SCENARIO_SHORT_LABELS: Record<Scenario, string> = {
  ssp126: 'Low-emissions (+1.5°C)',
  ssp245: 'Middle-of-the-road (+2.7°C)',
  ssp585: 'High-emissions (+4.0°C)',
};

export const INDICATOR_LABELS: Record<Indicator, string> = {
  heatwave: 'Extreme heat',
  rga: 'Clay shrink-swell',
  flooding: 'Flooding',
  water_stress: 'Drought & water',
  catnat: 'Natural disaster history',
  prix_immo: 'Property prices',
  cher_expose: 'Property prices and disaster history',
  services: 'Essential services',
  voiture_menages: 'Households with a car',
  voiture_travail: 'Commuting by car',
  transports_communs: 'Commuting by public transport',
  fragilites: 'Cumulative territorial fragilities',
};

/** Une phrase claire sur ce que montrent les couleurs, par aléa actif. */
export const INDICATOR_EXPLANATIONS: Record<Indicator, string> = {
  heatwave: 'Days of extreme heat (above 35°C) combined with population exposure.',
  rga: 'Clay soils that swell then shrink, cracking houses.',
  flooding: 'Low-lying areas and waterways liable to overflow into homes.',
  water_stress: 'Summer water shortages for residents, crops and rivers.',
  catnat: 'Official natural-disaster declarations (CatNat) recorded in the municipality since 1982 (observed).',
  prix_immo: 'Median price per m² for house and apartment sales 2023-2025 (DVF, observed).',
  cher_expose: 'Exploratory analysis: compares observed property prices with the number of recognised CatNat declarations. Does not measure the exposure of an individual home.',
  services: 'Essential service categories present in the municipality (BPE 2025, observed — presence, not distance).',
  voiture_menages: 'Share of households with at least one car (RP 2023, observed).',
  voiture_travail: 'Share of employed workers commuting to work by car (RP 2023, observed).',
  transports_communs: 'Share of employed workers commuting to work by public transport (RP 2023, observed).',
  fragilites: 'Simple equal-weight count of three observed dimensions crossing documented thresholds: CatNat declarations since 1982, service categories present locally, car commuting. Not a risk score.',
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
  | { id: number; type: 'getCommuneProfile'; payload: { codeInsee: string } }
  | {
      id: number;
      type: 'getDepartementMetrics';
      payload: { scenario: Scenario; indicator: Indicator; year: number };
    };

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
  | {
      id: number;
      ok: true;
      type: 'getDepartementMetrics';
      codes: string[];
      composite: Float32Array;
      hazard: Float32Array;
      elapsedMs: number;
    }
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
