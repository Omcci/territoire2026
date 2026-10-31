import {
  INDICATOR_LABELS,
  SCENARIO_LABELS,
  type CommuneHistoryRow,
  type CommuneProfile,
  type Indicator,
  type Scenario,
} from './metricsTypes';

export interface ExecutiveBrief {
  diagnostic: string;
  recommendations: string[];
  risk1990: number | null;
  risk2050: number | null;
  risk2100: number | null;
}

const RECOMMENDATIONS: Record<Indicator, [string, string, string]> = {
  heatwave: [
    'Végétalisation ciblée des îlots de chaleur : porter la canopée à 30 % sur les secteurs denses et désimperméabiliser les cours d’école (PNACC-3, trajectoire +4 °C).',
    'Plan canicule communal : recensement des personnes vulnérables, salles fraîches et horaires adaptés des services publics dès 2050.',
    'Prescriptions PLU : albédo élevé des toitures, ombrage des espaces publics et corridors de ventilation dans les nouvelles opérations.',
  ],
  rga: [
    'Moratoire ciblé : suspendre les permis de construire sur les parcelles à aléa argile fort sans étude géotechnique G2 préalable (PNACC-3).',
    'Diagnostic du parc existant : cartographier les maisons individuelles fissurées et prioriser les reprises en sous-œuvre aidées.',
    'Gestion des eaux pluviales : interdire les puisards près des fondations et stabiliser l’humidité des sols par drainage périphérique.',
  ],
  flooding: [
    'Désimperméabilisation des bassins versants urbains et restauration des zones d’expansion de crue en amont du bourg (PNACC-3).',
    'Révision du PPRI et gel des constructions nouvelles en zone d’aléa fort ; surélévation des équipements sensibles.',
    'Résilience des réseaux : protection des stations d’épuration et des postes électriques, exercice communal de crise inondation.',
  ],
  water_stress: [
    'Sobriété hydrique : plan de réduction des prélèvements agricoles et domestiques, tarification incitative estivale (PNACC-3).',
    'Résilience des réseaux d’eau : interconnexions, recherche de fuites et réutilisation des eaux usées traitées pour l’irrigation.',
    'Adaptation agricole : cultures résistantes à la sécheresse, haies et agroforesterie pour limiter l’évaporation des sols.',
  ],
};

function atYear(rows: CommuneHistoryRow[], year: number): number | null {
  return rows.find((r) => r.year === year)?.composite ?? null;
}

function levelLabel(score: number): string {
  if (score >= 0.66) return 'critique';
  if (score >= 0.45) return 'élevé';
  if (score >= 0.28) return 'modéré';
  return 'contenu';
}

/**
 * Synthèse exécutive déterministe (aucun appel IA externe) construite
 * uniquement à partir des historiques DuckDB-WASM de la commune.
 */
export function buildExecutiveBrief(
  profile: CommuneProfile | null,
  rows: CommuneHistoryRow[],
  scenario: Scenario,
  indicator: Indicator,
): ExecutiveBrief {
  const current = rows
    .filter((r) => r.scenario === scenario && r.indicator === indicator)
    .sort((a, b) => a.year - b.year);
  const risk1990 = atYear(current, 1990);
  const risk2050 = atYear(current, 2050);
  const risk2100 = atYear(current, 2100);
  const name = profile?.nom ?? 'Cette commune';
  const label = INDICATOR_LABELS[indicator].toLowerCase();

  let diagnostic: string;
  if (risk2050 === null || risk2100 === null) {
    diagnostic = `${name} : historique insuffisant pour établir un diagnostic ${label} sur la trajectoire ${SCENARIO_LABELS[scenario]}.`;
  } else {
    const delta =
      risk1990 !== null ? `, soit ${risk2100 - risk1990 >= 0 ? '+' : ''}${(risk2100 - risk1990).toFixed(2)} par rapport à 1990` : '';
    diagnostic =
      `${name} présente un risque ${label} ${levelLabel(risk2050)} à l’horizon 2050 ` +
      `(score composite ${risk2050.toFixed(2)}), qui atteint ${risk2100.toFixed(2)} en 2100${delta} ` +
      `sur la trajectoire ${SCENARIO_LABELS[scenario]}. ` +
      (profile
        ? `L’exposition (${profile.exposure.toFixed(2)}) et la vulnérabilité (${profile.vulnerability.toFixed(2)}) locales modulent fortement cet aléa : les secteurs exposés doivent être traités en priorité dans les documents d’urbanisme.`
        : `Les secteurs les plus exposés doivent être traités en priorité dans les documents d’urbanisme.`);
  }

  return {
    diagnostic,
    recommendations: [...RECOMMENDATIONS[indicator]],
    risk1990,
    risk2050,
    risk2100,
  };
}
