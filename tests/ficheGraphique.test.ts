import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const modal = readFileSync(new URL('../src/components/ui/ExecutiveBriefModal.tsx', import.meta.url), 'utf8');
const dock = readFileSync(new URL('../src/components/ui/TimelineDock.tsx', import.meta.url), 'utf8');
const map = readFileSync(new URL('../src/components/map/HybridMap3D.tsx', import.meta.url), 'utf8');

test('Graphique de fiche : segments droits, aucune courbe lissée ni dégradé décoratif', () => {
  assert.ok(!modal.includes('smoothPath'), 'pas de lissage Catmull-Rom/Bézier');
  assert.ok(!modal.includes('linearGradient'), 'pas de dégradé de remplissage');
  assert.ok(modal.includes('straightPath'), 'les horizons sont reliés par segments droits');
  assert.ok(modal.includes('CHART_UNITS'), 'l’unité du graphique est explicite');
});

test('Frise : bouton compact ouvrable, aucun Play/Pause, aucun voile cartographique', () => {
  assert.ok(dock.includes('Open the time horizons'));
  assert.ok(!dock.includes('Lecture') && !dock.includes('Pause'), 'aucun bouton de lecture');
  assert.ok(!dock.includes('isPlaying'), 'aucune lecture automatique');
  assert.ok(!map.includes('ThreeAtmosphere'), 'aucune couche atmosphérique');
  assert.ok(!map.includes('setHeat'), 'aucun voile lié à l’année ou au scénario');
});
