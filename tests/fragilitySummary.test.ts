import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFragilitySummary, FRAGILITY_THRESHOLDS } from '../src/lib/executiveBrief.ts';
import type { CommuneHistoryRow, Indicator } from '../src/lib/metricsTypes.ts';

// État observé de référence lu par la synthèse : ssp245 / 2025 (plateau).
const row = (indicator: Indicator, hazardLocal: number, composite: number): CommuneHistoryRow => ({
  scenario: 'ssp245',
  indicator,
  year: 2025,
  hazardRaw: hazardLocal,
  hazardLocal,
  exposure: 0.5,
  vulnerability: 0.5,
  composite,
});

test('Fragility summary: thresholds match the documented pipeline rules', () => {
  assert.equal(FRAGILITY_THRESHOLDS.catnatMinDeclarations, 10);
  assert.equal(FRAGILITY_THRESHOLDS.servicesMaxFamilies, 2);
  assert.equal(FRAGILITY_THRESHOLDS.carMinPercent, 80);
});

test('Fragility summary: each dimension is explained with its observed value and status', () => {
  const summary = buildFragilitySummary([
    row('catnat', 20, 0.8), // >= 10 : flagged
    row('services', 152, 7 / 7), // 7 familles : not flagged
    row('voiture_travail', 87, 0.87), // >= 80 % : flagged
  ]);
  assert.equal(summary.count, 2);
  assert.deepEqual(
    summary.dimensions.map((d) => d.status),
    ['flagged', 'not-flagged', 'flagged'],
  );
  assert.ok(summary.dimensions[0]?.observedText.includes('20 declarations'));
  assert.ok(summary.dimensions[0]?.ruleText.includes('10 declarations or more'));
  assert.ok(summary.dimensions[1]?.observedText.includes('7 of 7 categories'));
  assert.ok(summary.dimensions[2]?.observedText.includes('87%'));
  assert.ok(summary.dimensions[2]?.dataLabel.includes('2023'));
});

test('Fragility summary: boundary values follow the pipeline comparisons', () => {
  const summary = buildFragilitySummary([
    row('catnat', 10, 0.4),
    row('services', 40, 2 / 7),
    row('voiture_travail', 80, 0.8),
  ]);
  assert.equal(summary.count, 3);
});

test('Fragility summary: unpublished car share means not assessed and no total', () => {
  const summary = buildFragilitySummary([
    row('catnat', 3, 0.2),
    row('services', 12, 1 / 7),
    row('voiture_travail', -1, -1), // sentinelle : moins de 30 actifs
  ]);
  assert.equal(summary.count, null);
  const car = summary.dimensions.find((d) => d.key === 'voiture');
  assert.equal(car?.status, 'not-assessed');
  assert.ok(car?.explanation.includes('not calculated'));
  // Une dimension non évaluée n'est jamais assimilée à « non défavorable ».
  assert.notEqual(car?.status, 'not-flagged');
});
