/**
 * Sélection géographique : la commune sélectionnée est toujours celle de
 * la feature réellement cliquée. La caméra se cadre sur la géométrie de
 * cette feature (sa boîte englobante), jamais sur un centroïde externe
 * qui pourrait désigner un autre endroit.
 */

export type Bbox = [number, number, number, number];

/** Boîte englobante d'une géométrie GeoJSON (Polygon / MultiPolygon). */
export function geometryBbox(geometry: { coordinates?: unknown } | undefined | null): Bbox | null {
  if (!geometry?.coordinates) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const walk = (node: unknown): void => {
    if (Array.isArray(node) && typeof node[0] === 'number' && typeof node[1] === 'number') {
      const [x, y] = node as [number, number];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    if (Array.isArray(node)) node.forEach(walk);
  };
  walk(geometry.coordinates);
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

/** Centre d'une boîte englobante (repli caméra si le cadrage complet échoue). */
export function bboxCenter(bbox: Bbox): [number, number] {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}
