import type { MetricPoint } from './metricsTypes';

/**
 * Complétion de la couverture métriques (Étape 1 — zéro trou blanc).
 *
 * La géographie affichée est réelle (Etalab/IGN) mais les métriques sont
 * le jeu de démonstration joint par code INSEE : certaines communes
 * réelles n'ont pas de ligne dans les Parquet. Deux mécanismes, dans
 * l'ordre :
 *  1. Paris / Lyon / Marseille : la valeur de la commune-centre est
 *     propagée sur ses arrondissements municipaux.
 *  2. Repli départemental : toute commune encore absente reçoit la
 *     moyenne de son département (deux premiers caractères du code),
 *     ou la moyenne nationale si le département est absent des données.
 * Aucune valeur existante n'est jamais écrasée.
 */

function rangeCodes(prefix: string, from: number, to: number): string[] {
  const codes: string[] = [];
  for (let n = from; n <= to; n += 1) codes.push(`${prefix}${String(n).padStart(2, '0')}`);
  return codes;
}

export const CITY_PROPAGATION: readonly {
  city: string;
  /** Codes candidats de la commune-centre (réel puis synthétique démo). */
  sources: readonly string[];
  targets: readonly string[];
}[] = [
  { city: 'Paris', sources: ['75056'], targets: rangeCodes('751', 1, 20) },
  { city: 'Marseille', sources: ['13055'], targets: rangeCodes('132', 1, 16) },
  { city: 'Lyon', sources: ['69123'], targets: rangeCodes('693', 81, 89) },
];

/**
 * Alias fiche décisionnelle : un arrondissement (ou la commune-centre
 * réelle) se rattache au code qui porte les métriques de la ville dans
 * les Parquet — le même code source que la propagation cartographique,
 * pour que la fiche affiche exactement la couleur vue sur la carte.
 * Paris : 75056 / 751xx -> 75056 (code communal officiel).
 * Marseille : 132xx -> 13055 ; Lyon : 693xx -> 69123 (présents tels quels).
 */
export function resolveMetricCode(codeInsee: string): string {
  if (codeInsee === '75056' || codeInsee.startsWith('751')) return '75056';
  if (codeInsee === '13055' || codeInsee.startsWith('132')) return '13055';
  if (codeInsee === '69123' || codeInsee.startsWith('693')) return '69123';
  return codeInsee;
}

export function completeMetrics(
  metrics: ReadonlyMap<string, MetricPoint>,
  allCommuneCodes: readonly string[],
  preserveMissing = false,
): Map<string, MetricPoint> {
  const out = new Map(metrics);

  // 1) Arrondissements des trois grandes villes.
  for (const { sources, targets } of CITY_PROPAGATION) {
    const sourceCode = sources.find((code) => out.has(code));
    const point = sourceCode ? out.get(sourceCode) : undefined;
    if (!point) continue;
    for (const target of targets) {
      if (!out.has(target)) out.set(target, { ...point });
    }
  }

  // 2) Moyennes départementales puis nationale, sur les valeurs complétées.
  // En mode preserveMissing (indicateurs prix observés), la sentinelle
  // composite -1 « non établi » est exclue des moyennes et n'est jamais
  // remplacée par une moyenne : un code absent reçoit -1, pas une estimation.
  const deptSums = new Map<string, { composite: number; hazard: number; n: number }>();
  let national = { composite: 0, hazard: 0, n: 0 };
  for (const [code, point] of out) {
    if (preserveMissing && point.composite < 0) continue;
    const dept = code.slice(0, 2);
    const acc = deptSums.get(dept) ?? { composite: 0, hazard: 0, n: 0 };
    acc.composite += point.composite;
    acc.hazard += point.hazard;
    acc.n += 1;
    deptSums.set(dept, acc);
    national = {
      composite: national.composite + point.composite,
      hazard: national.hazard + point.hazard,
      n: national.n + 1,
    };
  }
  const nationalAvg: MetricPoint =
    national.n > 0
      ? { composite: national.composite / national.n, hazard: national.hazard / national.n }
      : { composite: 0, hazard: 0 };

  for (const code of allCommuneCodes) {
    if (out.has(code)) continue;
    if (preserveMissing) {
      out.set(code, { composite: -1, hazard: 0 });
      continue;
    }
    const acc = deptSums.get(code.slice(0, 2));
    out.set(
      code,
      acc && acc.n > 0
        ? { composite: acc.composite / acc.n, hazard: acc.hazard / acc.n }
        : { ...nationalAvg },
    );
  }
  return out;
}
