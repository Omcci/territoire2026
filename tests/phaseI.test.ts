import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Phase I : le clic départemental ne vole plus sur le point cliqué et cède la priorité aux communes', () => {
  const src = read('src/components/map/HybridMap3D.tsx');
  assert.ok(src.includes('geometryBbox'), 'le cadrage doit utiliser la géométrie de la feature');
  assert.ok(src.includes('queryRenderedFeatures(event.point'), 'la couche commune doit être interrogée au point');
  assert.ok(!src.includes('pitch: 35'), 'le vol départemental ne doit plus incliner la carte');
});

test('Phase I : aucun contrôle temporel ni scénario température pour les indicateurs observés', () => {
  const dock = read('src/components/ui/TimelineDock.tsx');
  assert.ok(dock.includes('if (OBSERVED_INDICATORS.has(indicator)) return null;'));
  const legend = read('src/components/ui/Legend.tsx');
  assert.ok(legend.includes('{!OBSERVED_PERIODS[indicator] && ('), 'les boutons +1,5/+2,7/+4,0 °C doivent être masqués pour les observés');
});

test('Phase I : le niveau Régional a de vraies limites et ne vole plus sur Paris', () => {
  const selector = read('src/components/ui/FinesseSelector.tsx');
  assert.ok(!selector.includes("[2.3522, 48.8566]"), 'aucun vol codé en dur sur Paris');
  assert.ok(existsSync(new URL('../public/data/geo/regions.geojson', import.meta.url)));
  const regions = JSON.parse(read('public/data/geo/regions.geojson')) as {
    features: { properties: { code: string; nom: string } }[];
  };
  assert.equal(regions.features.length, 13);
  assert.ok(regions.features.some((f) => f.properties.nom === 'Île-de-France'));
  assert.ok(regions.features.some((f) => f.properties.nom === 'Nouvelle-Aquitaine'));
  const map = read('src/components/map/HybridMap3D.tsx');
  assert.ok(map.includes('zoom < 6.2'), 'la bande régionale doit commencer sous le zoom France entière');
});

test('Phase I : hauteur 3D sans valeur inventée par défaut', () => {
  const src = read('src/components/map/HybridMap3D.tsx');
  assert.ok(src.includes("['get', 'height'], 0]"), 'hauteur inconnue = 0, pas 8 m arbitraires');
});
