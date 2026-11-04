import {
  INDICATOR_LABELS,
  SCENARIO_LABELS,
  type CommuneHistoryRow,
  type CommuneProfile,
  type Indicator,
  type Scenario,
} from './metricsTypes.ts';

/**
 * Mesure communale présentée dans la fiche : un nom naturel, une valeur
 * avec unité, une période et une explication de ce qui est mesuré.
 * Aucun niveau arbitraire (« vigilance », « alerte », « crise »), aucun
 * score composite présenté comme un risque, aucune recommandation
 * locale automatique : les données disponibles ne les justifient pas.
 */
export interface CommuneMeasure {
  /** Nom de la mesure, en français naturel. */
  title: string;
  /** Valeur principale formulée avec son unité. */
  headline: string;
  /** Période et nature (observé / simulation). */
  period: string;
  /** Ce que mesure cet indicateur, et ce qu'il ne mesure pas. */
  explanation: string;
  /** Lecture locale courte et factuelle (phrases courtes, un seul horizon par phrase). */
  reading: string;
}

const SIMULES: ReadonlySet<Indicator> = new Set(['heatwave', 'rga', 'flooding', 'water_stress']);

export function isSimulated(indicator: Indicator): boolean {
  return SIMULES.has(indicator);
}

function rowsFor(rows: CommuneHistoryRow[], scenario: Scenario, indicator: Indicator): CommuneHistoryRow[] {
  return rows
    .filter((r) => r.scenario === scenario && r.indicator === indicator)
    .sort((a, b) => a.year - b.year);
}

function at(rows: CommuneHistoryRow[], year: number): CommuneHistoryRow | undefined {
  return rows.find((r) => r.year === year);
}

const fmtInt = (v: number): string => Math.round(v).toLocaleString('en-US');

/**
 * Synthèse des fragilités cumulées : les trois dimensions observées, la
 * règle appliquée à chacune et son statut. Les seuils sont ceux du
 * pipeline (scripts/build_synthese_partitions.py : SEUIL_CATNAT,
 * SEUIL_SERVICES_MAX, SEUIL_VOITURE) — des conventions de lecture
 * documentées, pas des normes. Comptage à poids égaux : une dimension
 * franchie = un point, sans pondération ni normalisation.
 */
export const FRAGILITY_THRESHOLDS = {
  catnatMinDeclarations: 10,
  servicesMaxFamilies: 2,
  carMinPercent: 80,
} as const;

export type FragilityStatus = 'flagged' | 'not-flagged' | 'not-assessed';

export interface FragilityDimension {
  key: 'catnat' | 'services' | 'voiture';
  name: string;
  /** Ce qui est mesuré, avec la source et le millésime. */
  dataLabel: string;
  /** Valeur observée dans la commune. */
  observedText: string;
  /** Règle de classement réellement appliquée par le pipeline. */
  ruleText: string;
  status: FragilityStatus;
  /** Pourquoi ce statut, en une phrase. */
  explanation: string;
}

export interface FragilitySummary {
  /** Nombre de dimensions franchies, ou null si le comptage n'est pas calculé. */
  count: number | null;
  dimensions: FragilityDimension[];
}

export function buildFragilitySummary(rows: CommuneHistoryRow[]): FragilitySummary {
  // État observé de référence (ssp245 / 2025), comme le profil territorial :
  // la synthèse est un plateau observé, identique dans les trois scénarios.
  const ligne = (ind: Indicator) =>
    rows.find((r) => r.scenario === 'ssp245' && r.indicator === ind && r.year === 2025);
  const dimensions: FragilityDimension[] = [];

  const catnat = ligne('catnat');
  const declarations = catnat ? Math.round(catnat.hazardLocal) : null;
  dimensions.push({
    key: 'catnat',
    name: 'Natural-disaster history',
    dataLabel: 'Recognised natural-disaster (CatNat) declarations since 1982 — GASPAR, Géorisques',
    observedText:
      declarations === null ? 'Not reported for this municipality' : `${declarations} declaration${declarations === 1 ? '' : 's'} since 1982`,
    ruleText: `Flagged at ${FRAGILITY_THRESHOLDS.catnatMinDeclarations} declarations or more`,
    status:
      declarations === null ? 'not-assessed' : declarations >= FRAGILITY_THRESHOLDS.catnatMinDeclarations ? 'flagged' : 'not-flagged',
    explanation:
      declarations === null
        ? 'The source provides no count for this municipality, so this dimension is not assessed.'
        : declarations >= FRAGILITY_THRESHOLDS.catnatMinDeclarations
          ? 'The recorded history reaches the reading threshold chosen for a heavy disaster memory.'
          : 'The recorded history stays below the reading threshold of 10 declarations.',
  });

  const services = ligne('services');
  const families = services && services.composite >= 0 ? Math.round(services.composite * 7) : null;
  const facilities = services ? Math.round(services.hazardLocal) : null;
  dimensions.push({
    key: 'services',
    name: 'Essential services present locally',
    dataLabel:
      'Service categories present in the municipality, out of 7 (GP, pharmacy, school, food retail, post office, bank, early childcare) — INSEE, Base permanente des équipements, 1 January 2025',
    observedText:
      families === null
        ? 'Not reported for this municipality'
        : `${families} of 7 categories present${facilities !== null ? ` · ${facilities} ${facilities === 1 ? 'facility' : 'facilities'} recorded` : ''}`,
    ruleText: `Flagged at ${FRAGILITY_THRESHOLDS.servicesMaxFamilies} categories or fewer`,
    status: families === null ? 'not-assessed' : families <= FRAGILITY_THRESHOLDS.servicesMaxFamilies ? 'flagged' : 'not-flagged',
    explanation:
      families === null
        ? 'The source does not report service presence for this municipality, so this dimension is not assessed.'
        : families <= FRAGILITY_THRESHOLDS.servicesMaxFamilies
          ? 'Most everyday service categories are absent locally; residents must travel for them.'
          : 'More than two everyday service categories are present locally.',
  });

  const voiture = ligne('voiture_travail');
  const carPct = voiture && voiture.composite >= 0 ? Math.round(voiture.hazardLocal) : null;
  dimensions.push({
    key: 'voiture',
    name: 'Commuting by car',
    dataLabel: 'Share of employed workers who commute by car — INSEE population census, 2023',
    observedText: carPct === null ? 'Share not published for this municipality' : `${carPct}% of employed workers commute by car`,
    ruleText: `Flagged at ${FRAGILITY_THRESHOLDS.carMinPercent}% or more`,
    status: carPct === null ? 'not-assessed' : carPct >= FRAGILITY_THRESHOLDS.carMinPercent ? 'flagged' : 'not-flagged',
    explanation:
      carPct === null
        ? 'Fewer than 30 employed workers observed: the share is not published, this dimension is not assessed, and the overall count is therefore not calculated.'
        : carPct >= FRAGILITY_THRESHOLDS.carMinPercent
          ? 'Car commuting reaches the reading threshold chosen for strong car dependence.'
          : 'Car commuting stays below the reading threshold of 80%.',
  });

  // Même règle que le pipeline : si la dimension voiture n'est pas établie,
  // le comptage n'est pas calculé plutôt que réduit à deux dimensions.
  const count =
    carPct === null || declarations === null || families === null
      ? null
      : dimensions.filter((d) => d.status === 'flagged').length;
  return { count, dimensions };
}

export function buildCommuneMeasure(
  indicator: Indicator,
  profile: CommuneProfile | null,
  rows: CommuneHistoryRow[],
  scenario: Scenario,
): CommuneMeasure {
  const name = profile?.nom ?? 'This municipality';
  const current = rowsFor(rows, scenario, indicator);
  const row2025 = at(current, 2025);
  const row2050 = at(current, 2050);
  // Observé : le millésime réel (2025). Simulation : l'horizon 2050.
  const primary = SIMULES.has(indicator) ? (row2050 ?? row2025) : (row2025 ?? row2050);
  const hazard = primary?.hazardLocal ?? null;
  const composite = primary?.composite ?? null;
  const label = INDICATOR_LABELS[indicator];

  switch (indicator) {
    case 'catnat': {
      const arretes = hazard === null ? null : Math.round(hazard);
      return {
        title: 'Recognised natural disasters',
        headline:
          arretes === null
            ? 'CatNat declarations not available for this municipality'
            : `${arretes} CatNat declaration${arretes > 1 ? 's' : ''} since 1982`,
        period: 'Observed — recognised declarations from 1982 to 2025 (GASPAR, Géorisques)',
        explanation:
          'This figure counts the administrative recognitions of a state of natural disaster in the municipality. It does not directly measure the probability of a future disaster.',
        reading:
          arretes === null
            ? `${name}: the source does not provide the number of declarations for this municipality.`
            : `${name} has ${arretes} recognised declaration${arretes > 1 ? 's' : ''} since 1982. These recognitions show where events have already been observed and compensated. On their own, they are not sufficient to predict a future event.`,
      };
    }
    case 'prix_immo': {
      const fiable = hazard !== null && hazard > 0;
      return {
        title: 'Median property price',
        headline: fiable
          ? `Median transaction price: ${fmtInt(hazard)} €/m²`
          : 'Median price not available for this municipality',
        period: 'Observed — transactions 2023-2025 (DVF, DGFiP)',
        explanation: fiable
          ? 'Median price per square metre for houses and apartments sold in the municipality between 2023 and 2025. It covers only properties sold during that period.'
          : 'Fewer than 30 observed sales between 2023 and 2025: the median is not calculated, to avoid displaying an unreliable price.',
        reading: fiable
          ? `In ${name}, half of the 2023-2025 sales were completed above ${fmtInt(hazard)} €/m², and half below. This price describes the observed local market, not the value of each individual home.`
          : `In ${name}, the number of observed sales does not allow a reliable median price to be calculated. No substitute value is displayed.`,
      };
    }
    case 'cher_expose': {
      const arretes = hazard === null ? null : Math.round(hazard);
      // Le prix vient de la couche prix elle-même (même commune, même historique).
      const prixRow = at(rowsFor(rows, scenario, 'prix_immo'), 2025);
      const prix = prixRow?.hazardLocal ?? null;
      const prixFiable = prix !== null && prix > 0;
      return {
        title: 'Property prices and disaster history',
        headline:
          arretes === null
            ? 'Cross-analysis not available for this municipality'
            : prixFiable
              ? `${arretes} CatNat declarations since 1982 · median price ${fmtInt(prix)} €/m²`
              : `${arretes} CatNat declarations since 1982 · median price not available`,
        period: 'Exploratory analysis — observed prices 2023-2025 (DVF) and recognised declarations 1982-2025 (GASPAR)',
        explanation:
          'This analysis compares two municipal-level observations: the level of property prices and the number of recognised natural-disaster declarations. It measures neither the exposure of a specific home nor its risk of damage.',
        reading: prixFiable
          ? `In ${name}, a relatively expensive property market coexists with a history of ${arretes} recognised declarations. This municipal-level comparison does not show which homes were affected, nor why these two realities overlap.`
          : `In ${name}, the history counts ${arretes ?? 0} recognised declarations since 1982. The median price is not available (fewer than 30 observed sales), so the cross-analysis remains partial.`,
      };
    }
    case 'services': {
      const familles = composite === null ? null : Math.round(composite * 7);
      const equipements = hazard === null ? null : Math.round(hazard);
      return {
        title: 'Services and facilities present',
        headline:
          familles === null
            ? 'Service presence not reported for this municipality'
            : `${familles} of 7 service categories present · ${equipements ?? 0} ${(equipements ?? 0) === 1 ? 'facility' : 'facilities'} recorded`,
        period: 'Observed — Base permanente des équipements, as of 1 January 2025 (INSEE)',
        explanation:
          'The basket covers seven everyday categories: GP (general practitioner), pharmacy, school, food retail, post office, bank and early childcare. Presence in the municipality does not indicate how far the nearest service is for each resident.',
        reading: `In ${name}, ${familles ?? 0} of the 7 basket categories are present locally. A missing category means residents must leave the municipality for that service, though this map does not measure the journey required.`,
      };
    }
    case 'voiture_menages':
    case 'voiture_travail':
    case 'transports_communs': {
      const disponible = composite !== null && composite >= 0 && hazard !== null;
      const pct = disponible ? Math.round(hazard) : null;
      const sujet =
        indicator === 'voiture_menages'
          ? 'of households have at least one car'
          : indicator === 'voiture_travail'
            ? 'of employed workers use a car to get to work'
            : 'of employed workers use public transport to get to work';
      return {
        title: label,
        headline: disponible
          ? `${pct}% ${sujet}`
          : 'Share not available for this municipality',
        period: 'Observed — 2023 population census (INSEE)',
        explanation:
          indicator === 'voiture_menages'
            ? 'Owning a car does not show how it is used day to day: the two measures are therefore presented separately.'
            : 'This share describes commuting by employed workers. It measures neither the distances travelled nor whether an alternative exists for each journey.',
        reading: disponible
          ? `In ${name}, ${pct}% ${sujet} according to the 2023 census. This figure describes an observed pattern at municipal level, not the situation of each household.`
          : `In ${name}, the observed population is too small to publish this share (fewer than 30 ${indicator === 'voiture_menages' ? 'households' : 'employed workers'}). No substitute value is displayed.`,
      };
    }
    case 'fragilites': {
      const etabli = composite !== null && composite >= 0 && hazard !== null;
      const dims = etabli ? Math.round(hazard) : null;
      return {
        title: 'Cumulative territorial fragilities',
        headline: etabli
          ? `${dims} / 3 dimensions flagged`
          : 'Cumulative count not calculated for this municipality',
        period: 'Exploratory analysis — observations 2023-2025 (GASPAR, INSEE)',
        explanation:
          'The count adds together three observed situations: at least 10 CatNat declarations since 1982, at most 2 of 7 service categories present, and at least 80% of employed workers commuting by car. The thresholds are reading conventions, not standards.',
        reading: etabli
          ? `In ${name}, ${dims} of the three dimensions detailed below cross their reading threshold. This result is a simple count, with each dimension weighted equally: it is not a risk score, a probability or a prediction.`
          : `In ${name}, one of the dimensions cannot be established (share of workers commuting by car not available). The cumulative count is therefore not calculated, rather than assigning an incomplete value.`,
      };
    }
    default: {
      // Climat simulé (démonstration) : jamais présenté comme une mesure officielle.
      const traj = SCENARIO_LABELS[scenario];
      const unite =
        indicator === 'heatwave'
          ? `Around ${hazard === null ? '—' : Math.round(hazard)} days of extreme heat per year in 2050`
          : indicator === 'water_stress'
            ? `Around ${hazard === null ? '—' : Math.round(hazard)} days of water shortage per year in 2050`
            : indicator === 'rga'
              ? `Simulated clay shrink-swell index: ${hazard === null ? '—' : hazard.toFixed(1)} out of 10 in 2050`
              : `Simulated flood exposure index: ${hazard === null ? '—' : Math.round(hazard)} in 2050 (simulation-specific scale)`;
      const v2025 = row2025?.hazardLocal ?? null;
      return {
        title: label,
        headline: unite,
        period: `Demonstration simulation — ${traj}, 2050 horizon`,
        explanation:
          'These values are produced by the project’s demonstration model. They are not an official scientific projection, and the index shown has no equivalent in any public classification.',
        reading:
          hazard === null
            ? `${name}: the simulation does not provide a value for this municipality.`
            : `For ${name}, the simulation estimates ${unite.charAt(0).toLowerCase() + unite.slice(1).replace(/^simulated/, 'a simulated')} under the ${traj}. ${v2025 !== null && indicator !== 'rga' && indicator !== 'flooding' ? `For 2025, the same simulation gives around ${Math.round(v2025)} days per year. ` : ''}These figures are intended for comparing orders of magnitude between municipalities, not for forecasting the climate of a given year.`,
      };
    }
  }
}
