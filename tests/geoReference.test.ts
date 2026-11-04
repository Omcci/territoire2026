import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

interface Feature {
  properties: { code_insee?: string; code?: string; nom?: string };
  geometry: { type: string; coordinates: unknown };
}

const load = (p: string): Map<string, Feature> => {
  const data = JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')) as {
    features: Feature[];
  };
  const map = new Map<string, Feature>();
  for (const f of data.features) {
    const code = f.properties.code_insee ?? f.properties.code;
    if (code) map.set(code, f);
  }
  return map;
};

/** Appartenance d'un point à un polygone (ray casting, anneaux extérieurs). */
function pointInPolygon(lng: number, lat: number, geometry: Feature['geometry']): boolean {
  const rings: number[][][] =
    geometry.type === 'Polygon'
      ? [(geometry.coordinates as number[][][])[0] as number[][]]
      : geometry.type === 'MultiPolygon'
        ? (geometry.coordinates as number[][][][]).map((poly) => poly[0] as number[][])
        : [];
  return rings.some((ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i] as [number, number];
      const [xj, yj] = ring[j] as [number, number];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  });
}

const TEMOINS: Record<string, { nom: string; point: [number, number] }> = {
  '92024': { nom: 'Clichy', point: [2.30834, 48.90883] },
  '93055': { nom: 'Pantin', point: [2.40759, 48.89852] },
  '33063': { nom: 'Bordeaux', point: [-0.56, 44.86558] },
  '75056': { nom: 'Paris', point: [2.32012, 48.85729] },
  '93066': { nom: 'Saint-Denis', point: [2.35774, 48.92883] },
  '69123': { nom: 'Lyon', point: [4.82721, 45.76362] },
  '13055': { nom: 'Marseille', point: [5.44073, 43.29377] },
};

test('Référentiel réel : Clichy, Pantin, Bordeaux et Paris existent sous leurs codes officiels', () => {
  const communes = load('data/geo/communes.geojson');
  const manifest = JSON.parse(
    readFileSync(new URL('../data/geo/reference_manifest.json', import.meta.url), 'utf8'),
  ) as { communes: number; temoins: Record<string, { nom: string }> };

  assert.equal(communes.size, manifest.communes);
  assert.ok(communes.size > 34_000, 'le référentiel doit couvrir la France métropolitaine et la Corse');

  for (const [code, attendu] of Object.entries(TEMOINS)) {
    const feature = communes.get(code);
    assert.ok(feature, `commune ${code} absente du référentiel`);
    assert.equal(feature.properties.nom, attendu.nom, `${code} doit être ${attendu.nom}`);
    assert.equal(manifest.temoins[code]?.nom, attendu.nom);
    assert.ok(
      pointInPolygon(attendu.point[0], attendu.point[1], feature.geometry),
      `le point témoin ${attendu.point} doit être dans le polygone de ${attendu.nom} (${code})`,
    );
  }

  // Paris n'est plus un code synthétique : 75001 ne doit pas être une commune.
  assert.equal(communes.has('75001'), false);
});

test('Intégrité des codes : chaînes, zéros initiaux, Corse, jamais le nom seul', () => {
  const communes = load('data/geo/communes.geojson');
  // Zéro initial préservé (Ain) : le code est une chaîne de 5 caractères.
  const ain = communes.get('01001');
  assert.ok(ain, '01001 doit exister (zéro initial)');
  assert.equal(typeof ain.properties.code_insee ?? ain.properties.code, 'string');
  // Corse : codes alphanumériques 2A/2B présents tels quels.
  assert.equal(communes.get('2A004')?.properties.nom, 'Ajaccio');
  // Homonymie : plusieurs Saint-Denis existent ; seul le code identifie.
  const homonymes = [...communes.values()].filter((f) => f.properties.nom === 'Saint-Denis');
  assert.ok(homonymes.length >= 2, 'plusieurs communes portent le nom Saint-Denis');
  assert.ok(communes.get('93066'), 'le Saint-Denis de Seine-Saint-Denis est identifié par 93066');
});

test('Référentiel réel : aucun code séquentiel synthétique résiduel en Seine-Saint-Denis', () => {
  const communes = load('data/geo/communes.geojson');
  // Les codes réels de Seine-Saint-Denis sont épars (93055 Pantin…) ;
  // l'ancien référentiel s'arrêtait à 93040.
  assert.ok(communes.has('93055'));
  assert.ok(communes.has('93079') || communes.has('93070'));
});
