import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCommuneMeasure } from '../src/lib/executiveBrief.ts';
import type { CommuneHistoryRow, Indicator } from '../src/lib/metricsTypes.ts';

const row = (indicator: Indicator, year: number, hazardLocal: number, composite: number): CommuneHistoryRow => ({
  scenario: 'ssp585',
  indicator,
  year,
  hazardRaw: hazardLocal,
  hazardLocal,
  exposure: 0.5,
  vulnerability: 0.5,
  composite,
});

const FORBIDDEN = ['Vigilance', 'Alert level', 'Crisis level', 'Critical level', 'Exposed buildings', 'PNACC', 'Risk score'];

function assertClean(text: string) {
  for (const word of FORBIDDEN) {
    assert.ok(!text.includes(word), `forbidden wording present: ${word} in "${text.slice(0, 80)}"`);
  }
}

test('CatNat brief: declaration count, period and limit, no arbitrary level', () => {
  const m = buildCommuneMeasure('catnat', { nom: 'Rosny-sous-Bois', dept: '93', codeInsee: '93064', lat: 48.87, lon: 2.49, exposure: 0.5, vulnerability: 0.5 },
    [row('catnat', 2025, 20, 0.8), row('catnat', 2050, 20, 0.8)], 'ssp585');
  assert.ok(m.headline.includes('20 CatNat declarations'));
  assert.ok(m.period.includes('1982'));
  assert.ok(m.explanation.includes('probability'));
  assertClean(m.headline + m.reading + m.explanation);
});

test('Property price brief: stated median, and honest unavailability', () => {
  const ok = buildCommuneMeasure('prix_immo', null, [row('prix_immo', 2025, 3976, 0.9)], 'ssp585');
  assert.ok(ok.headline.includes('3,976 €/m²'));
  const ko = buildCommuneMeasure('prix_immo', null, [row('prix_immo', 2025, -1, -1)], 'ssp585');
  assert.ok(ko.headline.includes('not available'));
  assert.ok(!ko.headline.includes('€'), 'no price must be invented');
  assertClean(ok.headline + ko.headline);
});

test('Crossed price × CatNat brief: exploratory analysis, not a risk', () => {
  const m = buildCommuneMeasure('cher_expose', null, [
    row('cher_expose', 2025, 20, 0.7),
    row('prix_immo', 2025, 5100, 0.95),
  ], 'ssp585');
  assert.equal(m.title, 'Property prices and disaster history');
  assert.ok(m.headline.includes('20 CatNat declarations'));
  assert.ok(m.headline.includes('5,100 €/m²'));
  assert.ok(m.explanation.includes('measures neither'));
  assertClean(m.title + m.headline + m.reading);
});

test('Mobility and simulation briefs: natural wording, explicit nature', () => {
  const mob = buildCommuneMeasure('voiture_travail', null, [row('voiture_travail', 2025, 34, 0.34)], 'ssp585');
  assert.ok(mob.headline.includes('34%') || mob.headline.includes('34 %'));
  assert.ok(mob.period.includes('2023'));
  const sim = buildCommuneMeasure('heatwave', null, [row('heatwave', 2025, 9, 0.3), row('heatwave', 2050, 13, 0.4)], 'ssp585');
  assert.ok(sim.headline.includes('13 days'));
  assert.ok(sim.period.toLowerCase().includes('simulation'));
  assert.ok(sim.explanation.includes('not an official scientific projection'));
  assertClean(mob.headline + sim.headline + sim.reading);
});
