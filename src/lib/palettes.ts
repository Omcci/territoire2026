import type { Indicator } from './metricsTypes';

/**
 * Palettes différenciées par aléa (7 paliers), pensées pour rester
 * lisibles sur le fond de carte sombre CartoDB Dark Matter.
 * Index 0 = risque nul, index 6 = risque maximal.
 */
export const ALEA_PALETTES: Record<Indicator, readonly string[]> = {
  heatwave: ['#fae4c9', '#f8cd8d', '#f6ad5c', '#f3973c', '#e05e1f', '#d74415', '#7d0b0f'],
  rga: ['#f6e8c3', '#ecd9a0', '#dfc27d', '#d0a24e', '#bf812d', '#8c510a', '#543005'],
  flooding: ['#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#3182bd', '#08306b'],
  water_stress: ['#e6f4f1', '#a7d8d0', '#5fb4ad', '#d9c26a', '#e09f3e', '#b3541e', '#6b2108'],
  catnat: ['#eef1f4', '#d8e0e8', '#b4c5d4', '#87a3bb', '#5b7f9e', '#35597a', '#16324e'],
  prix_immo: ['#f3eef7', '#e2d5ee', '#c6abe0', '#a57cc6', '#7f53a8', '#5b3484', '#37205c'],
  cher_expose: ['#f7ecec', '#eccfcf', '#dda6a6', '#c97474', '#a63d3d', '#7d1f1f', '#4d0d0d'],
  services: ['#eef2ec', '#d9e6d6', '#b7d3b0', '#8ab87f', '#57974f', '#2f742f', '#144d1a'],
  voiture_menages: ['#f2ede6', '#e6d7bf', '#d6b98c', '#c08f52', '#9c6a2e', '#6f4517', '#422607'],
  voiture_travail: ['#f6e9e4', '#eecabd', '#e19f83', '#cd6f4a', '#a8481f', '#742a10', '#451505'],
  transports_communs: ['#ecf4f4', '#d3e8e8', '#a9d1d1', '#74b0b0', '#448a8a', '#256363', '#0f4040'],
  fragilites: ['#edf0e8', '#e2dbc0', '#d3bd8a', '#bd9257', '#9c6630', '#744015', '#472305'],
};

export const PALETTE_STOPS: readonly number[] = [0, 0.18, 0.34, 0.5, 0.66, 0.82, 1];

export const LEVEL_WORDS: readonly string[] = [
  'Low',
  'Moderate',
  'Watch',
  'High',
  'Alert',
  'Severe',
  'Crisis',
];

/** Sources officielles affichées dans l'accordéon de chaque carte de légende. */
export const INDICATOR_SOURCES: Record<Indicator, string> = {
  heatwave: 'Météo-France — DRIAS projections (Territoires 2100 demonstration data)',
  rga: 'Géorisques / BRGM — clay shrink-swell (demonstration data)',
  flooding: 'Géorisques — flood-prone areas (Territoires 2100 demonstration data)',
  water_stress: 'Météo-France DRIAS & INSEE — water resource stress (demo)',
  catnat: 'Géorisques / GASPAR — official natural-disaster declarations (CatNat) 1982-2025 (observed data, Licence Ouverte)',
  prix_immo: 'DGFiP / data.gouv.fr — Demandes de valeurs foncières (DVF) 2023-2025, median price per m², municipalities with 30 or more sales (observed data, Licence Ouverte 2.0)',
  cher_expose: 'Derived cross-analysis DGFiP DVF 2023-2025 × Géorisques GASPAR 1982-2025 (observed data, Open Licences) — method and limitations in the story, scripts/build_dvf_catnat_partitions.py',
  services: 'INSEE — Base permanente des équipements (BPE) as of 1 January 2025, presence in the municipality (observed data, Licence Ouverte) — scripts/build_bpe_partitions.py',
  voiture_menages: 'INSEE — 2023 Census (Melodi, DS_RP_LOGEMENT_PRINC), households in main residence (observed data, Licence Ouverte 2.0)',
  voiture_travail: 'INSEE — 2023 Census (Melodi, DS_RP_NAVETTES_PRINC), employed workers aged 15 and over (observed data, Licence Ouverte 2.0)',
  transports_communs: 'INSEE — 2023 Census (Melodi, DS_RP_NAVETTES_PRINC), employed workers aged 15 and over (observed data, Licence Ouverte 2.0)',
  fragilites: 'Count derived from the project’s observed indicators (GASPAR, BPE 2025, RP 2023) — thresholds and method in the story, scripts/build_synthese_partitions.py',
};

/** Gris réservé aux données insuffisantes (composite sentinelle -1, audit D.1). */
export const MISSING_COLOR = '#c8c8bf';

/**
 * Expression MapLibre interpolate sur une clé de feature-state donnée.
 * Un composite négatif (sentinelle « non établi » des indicateurs prix)
 * est rendu en gris explicite, distinct du zéro réel le plus clair.
 */
export function paletteColorExpression(indicator: Indicator, featureStateKey: string): unknown[] {
  const colors = ALEA_PALETTES[indicator];
  const interpolate: unknown[] = [
    'interpolate',
    ['linear'],
    ['coalesce', ['feature-state', featureStateKey], 0],
  ];
  PALETTE_STOPS.forEach((stop, i) => {
    interpolate.push(stop, colors[i] ?? colors[colors.length - 1]);
  });
  return ['case', ['<', ['coalesce', ['feature-state', featureStateKey], 0], 0], MISSING_COLOR, interpolate];
}
