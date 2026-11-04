import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completeMetrics, resolveMetricCode } from '../src/lib/metricsCoverage.ts';
import type { MetricPoint } from '../src/lib/metricsTypes.ts';

const pt = (composite: number, hazard = composite * 10): MetricPoint => ({ composite, hazard });

test('Paris : la valeur de la commune-centre est propagée aux 20 arrondissements', () => {
  const metrics = new Map([['75056', pt(0.8)]]);
  const out = completeMetrics(metrics, ['75101', '75120', '75056']);
  assert.equal(out.get('75101')?.composite, 0.8);
  assert.equal(out.get('75120')?.composite, 0.8);
  // Une valeur d'arrondissement déjà présente n'est jamais écrasée.
  const existing = new Map([
    ['75056', pt(0.6)],
    ['75101', pt(0.3)],
  ]);
  assert.equal(completeMetrics(existing, []).get('75101')?.composite, 0.3);
});

test('Marseille et Lyon : propagation aux arrondissements', () => {
  const metrics = new Map([
    ['13055', pt(0.5)],
    ['69123', pt(0.4)],
  ]);
  const out = completeMetrics(metrics, ['13201', '13216', '69381', '69389']);
  assert.equal(out.get('13201')?.composite, 0.5);
  assert.equal(out.get('13216')?.composite, 0.5);
  assert.equal(out.get('69381')?.composite, 0.4);
  assert.equal(out.get('69389')?.composite, 0.4);
});

test('Alias fiche : les arrondissements se rattachent au code métrique de leur ville', () => {
  assert.equal(resolveMetricCode('75056'), '75056');
  assert.equal(resolveMetricCode('75101'), '75056');
  assert.equal(resolveMetricCode('75120'), '75056');
  assert.equal(resolveMetricCode('13201'), '13055');
  assert.equal(resolveMetricCode('13216'), '13055');
  assert.equal(resolveMetricCode('69381'), '69123');
  assert.equal(resolveMetricCode('69389'), '69123');
  assert.equal(resolveMetricCode('33063'), '33063'); // hors grandes villes : inchangé
});

test('Repli départemental : une commune absente reçoit la moyenne de son département', () => {
  const metrics = new Map([
    ['01001', pt(0.2)],
    ['01002', pt(0.6)],
    ['33001', pt(0.9)],
  ]);
  const out = completeMetrics(metrics, ['01999', '33999', '2A999']);
  assert.equal(out.get('01999')?.composite, 0.4); // moyenne du 01
  assert.equal(out.get('33999')?.composite, 0.9); // moyenne du 33
});

test('Département absent des données : moyenne nationale, jamais de trou', () => {
  const metrics = new Map([['01001', pt(0.4)]]);
  const out = completeMetrics(metrics, ['97101']);
  assert.equal(out.get('97101')?.composite, 0.4);
  assert.ok(out.size >= 2);
});

test('Mode preserveMissing : la sentinelle -1 n’est jamais remplacée par une moyenne', () => {
  const metrics = new Map<string, MetricPoint>([
    ['01001', pt(0.6)],
    ['01002', { composite: -1, hazard: 0 }],
  ]);
  const out = completeMetrics(metrics, ['01999', '97101'], true);
  // La sentinelle explicite est conservée telle quelle.
  assert.equal(out.get('01002')?.composite, -1);
  // Un code absent reçoit -1 (non établi), pas la moyenne départementale.
  assert.equal(out.get('01999')?.composite, -1);
  assert.equal(out.get('97101')?.composite, -1);
  // Le mode par défaut reste inchangé : repli par moyenne (sans sentinelle).
  const defaut = completeMetrics(new Map([['01001', pt(0.6)]]), ['01999']);
  assert.equal(defaut.get('01999')?.composite, 0.6);
});
