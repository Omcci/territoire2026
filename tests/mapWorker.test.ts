import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Garde-fou du bug « Worker failed to load » en preview (Phase H) :
// MapLibre v6 cherche son worker à côté du module principal, présent en
// dev (node_modules) mais absent du bundle /assets. L'URL du worker
// émis par Vite doit donc être fixée explicitement dans le code carte.
test('Carte : le worker MapLibre est explicitement câblé pour le build', () => {
  const source = readFileSync(new URL('../src/components/map/HybridMap3D.tsx', import.meta.url), 'utf-8');
  assert.match(source, /maplibre-gl-worker\.mjs\?url/);
  assert.match(source, /setWorkerUrl\(maplibreWorkerUrl\)/);
  // Les erreurs du fond externe ne doivent pas rouvrir l'écran fatal local.
  assert.match(source, /sourceId === SOURCE_ID/);
});
