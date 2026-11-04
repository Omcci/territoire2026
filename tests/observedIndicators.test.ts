import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MISSING_COLOR, paletteColorExpression } from '../src/lib/palettes.ts';

test('Palette : la sentinelle -1 est rendue en gris explicite, distinct du zéro réel', () => {
  for (const indicator of ['prix_immo', 'cher_expose'] as const) {
    const expr = paletteColorExpression(indicator, 'composite');
    assert.equal(expr[0], 'case');
    assert.ok(JSON.stringify(expr).includes(MISSING_COLOR));
  }
});

test('Palette : le zéro réel reste la première couleur de l’échelle, pas le gris', () => {
  const expr = paletteColorExpression('prix_immo', 'composite');
  const serialise = JSON.stringify(expr);
  // L'interpolation démarre au palier 0 avec la couleur la plus claire de prix_immo.
  assert.ok(serialise.includes('#f3eef7'));
  assert.notEqual(MISSING_COLOR, '#f3eef7');
});
