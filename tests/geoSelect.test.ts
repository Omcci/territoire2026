import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bboxCenter, geometryBbox } from '../src/lib/geoSelect.ts';

const POLYGON = {
  type: 'Polygon',
  coordinates: [
    [
      [2.29, 48.89],
      [2.32, 48.89],
      [2.32, 48.92],
      [2.29, 48.92],
      [2.29, 48.89],
    ],
  ],
};

test('geometryBbox : boîte englobante exacte du polygone cliqué', () => {
  assert.deepEqual(geometryBbox(POLYGON), [2.29, 48.89, 2.32, 48.92]);
  const [clng, clat] = bboxCenter([2.29, 48.89, 2.32, 48.92]);
  assert.ok(Math.abs(clng - 2.305) < 1e-9 && Math.abs(clat - 48.905) < 1e-9);
});

test('geometryBbox : MultiPolygon et géométrie absente', () => {
  const multi = {
    type: 'MultiPolygon',
    coordinates: [[POLYGON.coordinates], [[[2.4, 48.85], [2.42, 48.85], [2.42, 48.87], [2.4, 48.85]]]],
  };
  assert.deepEqual(geometryBbox(multi), [2.29, 48.85, 2.42, 48.92]);
  assert.equal(geometryBbox(undefined), null);
  assert.equal(geometryBbox(null), null);
});
