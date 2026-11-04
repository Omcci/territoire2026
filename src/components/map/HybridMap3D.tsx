import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type {
  LayerSpecification,
  Map as MapLibreMap,
  MapLayerMouseEvent,
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

// MapLibre v6 résout son worker en « ./maplibre-gl-worker.mjs » relatif à
// l'URL du module principal : servi depuis node_modules en dev (voisin
// présent), mais introuvable une fois le bundle émis en /assets (preview) —
// le serveur renvoie alors le HTML de repli et le worker échoue
// (« Worker failed to load »), laissant la carte blanche. On fixe donc
// explicitement l'URL du worker émis par Vite, valable en dev comme en build.
maplibregl.setWorkerUrl(maplibreWorkerUrl);
import { duckdbService } from '../../lib/duckdbService';
import {
  INDICATOR_LABELS,
  type Indicator,
  type MetricPoint,
  type MetricsMap,
} from '../../lib/metricsTypes';
import { paletteColorExpression } from '../../lib/palettes';
import { geometryBbox } from '../../lib/geoSelect';
import { STORY_STEPS, useAppStore } from '../../store/useAppStore';

const SOURCE_ID = 'communes';
const SOURCE_LAYER = 'communes';
const FILL_LAYER = 'communes-fill';
const CONTOUR_LAYER = 'city-contour';
const SELECTED_LAYER = 'communes-selected';
const BUILDING_SOURCE = 'openfreemap';
const BUILDING_BASE = 'building-base';
const BUILDING_3D = 'building-3d';
const BUILDING_BORDER = 'building-border';

const BASEMAP_STYLE_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const DEPT_SOURCE = 'departements';
const DEPT_FILL = 'departements-fill';
const REG_SOURCE = 'regions';
const REG_FILL = 'regions-fill';
const REG_CONTOUR = 'regions-contour';
const REG_SELECTED = 'regions-selected';

/** Diagnostic géographique désactivable : ajouter ?debug=geo à l'URL. */
const GEO_DEBUG =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('debug') === 'geo';
const DEPT_CONTOUR = 'departements-contour';
/** Bascule d'échelle : départements en dessous, communes au-dessus. */
const LOD_ZOOM = 7.5;
const BUILDINGS_TILES_URL = 'https://tiles.openfreemap.org/planet';

const CHUNK = 2500;
const RECIT_KEY = 'composite';

function freeLayerId(storeId: string): string {
  return `free-fill-${storeId}`;
}
function freeStateKey(storeId: string): string {
  return `free_${storeId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

/** Opacité de la nappe selon le zoom, modulée par le slider de légende. */
function zoomOpacity(multiplier: number): unknown[] {
  return [
    'interpolate', ['linear'], ['zoom'],
    5, 0.78 * multiplier,
    7.5, 0.74 * multiplier,
    10, 0.68 * multiplier,
    // Au niveau communal (Z >= 12), la nappe reste au sol à 0,55 sous le bâti 3D.
    12, 0.55 * multiplier,
    16.5, 0.55 * multiplier,
  ];
}

function hoverLine(indicator: Indicator, point: MetricPoint): string {
  const level =
    point.composite >= 0.66 ? 'Crisis' : point.composite >= 0.45 ? 'Alert' : point.composite >= 0.28 ? 'Vigilance' : 'Low';
  switch (indicator) {
    case 'heatwave':
      return `${Math.round(point.hazard)} days of extreme heat / year · ${level.toLowerCase()} risk`;
    case 'rga':
      return `Clay shrink-swell hazard ${point.composite >= 0.45 ? 'high' : point.composite >= 0.28 ? 'medium' : 'low'} · ${level.toLowerCase()} risk`;
    case 'flooding':
      return `Flood exposure ${point.composite >= 0.45 ? 'high' : point.composite >= 0.28 ? 'medium' : 'low'} · ${level.toLowerCase()} risk`;
    case 'water_stress':
      return `${Math.round(point.hazard)} days of water shortage / year · ${level.toLowerCase()} risk`;
    case 'catnat':
      return `${Math.round(point.hazard)} CatNat declarations recognized since 1982 (observed)`;
    case 'prix_immo':
      return point.hazard > 0
        ? `${Math.round(point.hazard).toLocaleString('en-US')} €/m² median (DVF 2023-2025, observed)`
        : 'Median price not available (fewer than 30 observed sales)';
    case 'fragilites':
      return point.composite < 0
        ? 'Cumulative count not calculated (car share not available, RP 2023)'
        : `${Math.round(point.hazard)} / 3 dimensions flagged (simple count: CatNat history, local services, car commuting)`;
    case 'voiture_menages':
      return point.composite < 0
        ? 'Not available for this municipality (fewer than 30 households observed, RP 2023)'
        : `${Math.round(point.hazard)}% of households have at least one car (RP 2023, observed)`;
    case 'voiture_travail':
      return point.composite < 0
        ? 'Not available for this municipality (fewer than 30 workers observed, RP 2023)'
        : `${Math.round(point.hazard)}% of workers commute by car (RP 2023, observed)`;
    case 'transports_communs':
      return point.composite < 0
        ? 'Not available for this municipality (fewer than 30 workers observed, RP 2023)'
        : `${Math.round(point.hazard)}% of workers commute by public transport (RP 2023, observed)`;
    case 'services': {
      const familles = Math.round(point.composite * 7);
      return familles === 0
        ? 'None of the 7 service categories in this municipality (BPE 2025, local presence)'
        : `${familles} of the 7 service categories present in this municipality · ${Math.round(point.hazard)} basket facilities locally (BPE 2025)`;
    }
    case 'cher_expose':
      if (point.composite < 0) {
        return point.hazard > 0
          ? `${Math.round(point.hazard)} CatNat declarations · price unreliable (fewer than 30 DVF sales), combined signal not established`
          : 'Price unreliable (fewer than 30 DVF sales), combined signal not established';
      }
      return `${Math.round(point.hazard)} CatNat declarations · price × disaster-history signal ${point.composite >= 0.45 ? 'strong' : point.composite >= 0.2 ? 'clear' : point.composite > 0 ? 'weak' : 'none'}`;
  }
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

const STATIC_LAYERS: LayerSpecification[] = [
  {
    id: FILL_LAYER,
    type: 'fill',
    source: SOURCE_ID,
    'source-layer': SOURCE_LAYER,
    minzoom: LOD_ZOOM,
    paint: { 'fill-opacity': 0.75 },
  },
  {
    id: BUILDING_BASE,
    type: 'fill',
    source: BUILDING_SOURCE,
    'source-layer': 'building',
    minzoom: 13,
    paint: { 'fill-color': '#f2f2f2', 'fill-opacity': 0.2 },
  },
  {
    id: BUILDING_3D,
    type: 'fill-extrusion',
    source: BUILDING_SOURCE,
    'source-layer': 'building',
    minzoom: 13,
    paint: {
      'fill-extrusion-color': '#f4f4f6',
      'fill-extrusion-height': [
        'interpolate', ['linear'], ['zoom'],
        13, 0,
        13.5, ['coalesce', ['get', 'render_height'], ['get', 'height'], 0],
      ],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.72,
      'fill-extrusion-vertical-gradient': true,
    },
  },
  {
    id: BUILDING_BORDER,
    type: 'line',
    source: BUILDING_SOURCE,
    'source-layer': 'building',
    minzoom: 13.5,
    paint: { 'line-color': 'rgba(180,180,180,0.5)', 'line-width': 0.5 },
  },
  {
    id: CONTOUR_LAYER,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': SOURCE_LAYER,
    minzoom: LOD_ZOOM,
    paint: {
      'line-color': '#ffffff',
      // Règle MAB : contour blanc net, toujours au-dessus des aplats.
      'line-opacity': 0.8,
      'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 11, 1.4],
    },
  },
  {
    id: SELECTED_LAYER,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': SOURCE_LAYER,
    minzoom: LOD_ZOOM,
    filter: ['==', ['get', 'code_insee'], ''],
    paint: { 'line-color': '#ffffff', 'line-opacity': 1, 'line-width': 2.2 },
  },
];

/** Niveau national (Z < 7.5) : nappe départementale continue, sans trou. */
const DEPT_LAYERS: LayerSpecification[] = [
  {
    id: DEPT_FILL,
    type: 'fill',
    source: DEPT_SOURCE,
    maxzoom: LOD_ZOOM,
    paint: { 'fill-opacity': 0.85 },
  },
  {
    id: DEPT_CONTOUR,
    type: 'line',
    source: DEPT_SOURCE,
    maxzoom: LOD_ZOOM,
    paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 0.8 },
  },
];

/** Niveau régional : limites régionales réelles (union des départements), sélection et surbrillance. */
const REGION_LAYERS: LayerSpecification[] = [
  {
    id: REG_FILL,
    type: 'fill',
    source: REG_SOURCE,
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#0f172a', 'fill-opacity': 0.02 },
  },
  {
    id: REG_SELECTED,
    type: 'line',
    source: REG_SOURCE,
    layout: { visibility: 'none' },
    filter: ['==', ['get', 'code'], ''],
    paint: { 'line-color': '#0f172a', 'line-width': 2.6, 'line-opacity': 0.9 },
  },
  {
    id: REG_CONTOUR,
    type: 'line',
    source: REG_SOURCE,
    layout: { visibility: 'none' },
    paint: { 'line-color': '#334155', 'line-width': 1.8, 'line-opacity': 0.75 },
  },
];

export default function HybridMap3D() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const applyFrameRef = useRef<number | null>(null);
  const applyTokenRef = useRef(0);
  const freeDataRef = useRef(new Map<string, MetricsMap>());
  const deptDataRef = useRef<MetricsMap>(new Map());
  const [mapError, setMapError] = useState<string | null>(null);
  /** Fond de carte externe (CARTO) injoignable : données locales affichées sur fond neutre. */
  const [basemapDegraded, setBasemapDegraded] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const metricsData = useAppStore((s) => s.metricsData);
  const indicator = useAppStore((s) => s.indicator);
  const selectedCommune = useAppStore((s) => s.selectedCommune);
  const communeProfile = useAppStore((s) => s.communeProfile);
  const storyStep = useAppStore((s) => s.storyStep);
  const mode = useAppStore((s) => s.mode);
  const year = useAppStore((s) => s.year);
  const scenario = useAppStore((s) => s.scenario);
  const recitLayerOpacity = useAppStore((s) => s.recitLayerOpacity);
  const recitOnTop = useAppStore((s) => s.recitOnTop);
  const freeNavLayers = useAppStore((s) => s.freeNavLayers);
  const currentLevel = useAppStore((s) => s.currentLevel);
  const selectedRegion = useAppStore((s) => s.selectedRegion);
  const selectedFeatureBbox = useAppStore((s) => s.selectedFeatureBbox);
  const entryChoice = useAppStore((s) => s.entryChoice);
  const entered = entryChoice === 'story' || entryChoice === 'explore';
  const cameraIntent = useAppStore((s) => s.cameraIntent);

  /* ---------- Application priorisée viewport + chunking rAF ---------- */
  const applyMetrics = (
    map: MapLibreMap,
    metrics: MetricsMap,
    stateKey: string,
    prioritiseViewport: boolean,
  ): void => {
    if (metrics.size === 0 || !map.getSource(SOURCE_ID)) return;
    const token = (applyTokenRef.current += 1);
    if (applyFrameRef.current !== null) cancelAnimationFrame(applyFrameRef.current);

    const entries = [...metrics.entries()];
    const done = new Set<string>();

    const applyOne = (code: string, point: MetricPoint): void => {
      // Écrase directement la clé : jamais de nettoyage global (anti-clignotement).
      map.setFeatureState({ source: SOURCE_ID, sourceLayer: SOURCE_LAYER, id: code }, { [stateKey]: point.composite });
      done.add(code);
    };

    // 1) Communes visibles à l'écran, immédiatement.
    if (prioritiseViewport && map.getLayer(FILL_LAYER)) {
      try {
        const visible = map.queryRenderedFeatures({ layers: [FILL_LAYER] });
        for (const feature of visible) {
          const code = typeof feature.id === 'string' ? feature.id : null;
          if (!code || done.has(code)) continue;
          const point = metrics.get(code);
          if (point) applyOne(code, point);
        }
      } catch {
        // Couche pas encore prête : le chunking prendra le relais.
      }
    }

    // 2) Le reste par lots de 2 500 via requestAnimationFrame.
    let index = 0;
    const step = (): void => {
      if (token !== applyTokenRef.current) return; // batch annulé par un plus récent
      const end = Math.min(entries.length, index + CHUNK);
      for (; index < end; index += 1) {
        const entry = entries[index];
        if (!entry || done.has(entry[0])) continue;
        applyOne(entry[0], entry[1]);
      }
      if (index < entries.length) applyFrameRef.current = requestAnimationFrame(step);
      else applyFrameRef.current = null;
    };
    applyFrameRef.current = requestAnimationFrame(step);
  };

  /* ---------- Initialisation ---------- */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let annule = false;
    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    const demarrer = async (): Promise<void> => {

    // Préflight du fond externe : s'il est injoignable, on démarre sur un
    // style local minimal (fond neutre) pour que les données locales
    // (PMTiles, départements) s'affichent quand même, avec un avis dégradé.
    let style: string | maplibregl.StyleSpecification = BASEMAP_STYLE_URL;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(BASEMAP_STYLE_URL, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      setBasemapDegraded(true);
      style = {
        version: 8,
        sources: {},
        layers: [{ id: 'fond-local', type: 'background', paint: { 'background-color': '#e9e7e1' } }],
      };
    }
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [2.55, 46.65],
      zoom: 5.6,
      pitch: 20,
      bearing: 0,
      minZoom: 4,
      maxZoom: 16.5,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true },
    });
    if (annule) {
      map.remove();
      return;
    }
    mapRef.current = map;
    // Diagnostic géographique (?debug=geo uniquement) : expose la carte
    // pour tracer/vérifier la chaîne de sélection. Inactif par défaut.
    if (GEO_DEBUG) {
      (window as unknown as { __TERRITOIRES_MAP__?: unknown }).__TERRITOIRES_MAP__ = map;
    }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-left');

    map.on('load', () => {
      setMapError(null);
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'vector',
          url: 'pmtiles:///france_communes.pmtiles',
          promoteId: { [SOURCE_LAYER]: 'code_insee' },
          attribution: 'Territoires 2100 (synthetic demo)',
        });
      }
      if (!map.getSource(BUILDING_SOURCE)) {
        map.addSource(BUILDING_SOURCE, { type: 'vector', url: BUILDINGS_TILES_URL });
      }
      if (!map.getSource(DEPT_SOURCE)) {
        map.addSource(DEPT_SOURCE, {
          type: 'geojson',
          data: '/data/geo/departements.geojson',
          promoteId: 'dept',
        });
      }
      if (!map.getSource(REG_SOURCE)) {
        map.addSource(REG_SOURCE, {
          type: 'geojson',
          data: '/data/geo/regions.geojson',
          promoteId: 'code',
        });
      }
      // Le fond Positron a déjà ses bâtiments 2D : les masquer (les nôtres sont en 3D).
      for (const styleLayer of map.getStyle().layers) {
        if (styleLayer.id.toLowerCase().includes('building') && styleLayer.type === 'fill') {
          map.setLayoutProperty(styleLayer.id, 'visibility', 'none');
        }
      }
      const labelAnchor = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      for (const layer of [...DEPT_LAYERS, ...REGION_LAYERS, ...STATIC_LAYERS]) {
        if (!map.getLayer(layer.id)) map.addLayer(layer, labelAnchor);
      }
      const initialIndicator = useAppStore.getState().indicator;
      map.setPaintProperty(DEPT_FILL, 'fill-color', paletteColorExpression(initialIndicator, RECIT_KEY) as never);
      const state = useAppStore.getState();
      map.setPaintProperty(FILL_LAYER, 'fill-color', paletteColorExpression(state.indicator, RECIT_KEY) as never);
      map.setPaintProperty(FILL_LAYER, 'fill-opacity', zoomOpacity(state.recitLayerOpacity) as never);
      setMapReady(true);
    });
    map.on('error', (e) => {
      // Seules les erreurs des sources LOCALES (communes PMTiles,
      // départements) rendent la carte indisponible. Les erreurs du fond
      // externe ou des bâtiments (tuile, glyphes) ne doivent pas masquer
      // des données locales pourtant chargées.
      const sourceId = (e as { sourceId?: string }).sourceId;
      if (sourceId === SOURCE_ID || sourceId === DEPT_SOURCE) {
        const message = e.error?.message;
        if (message) setMapError(message);
      } else if (!map.loaded()) {
        setBasemapDegraded(true);
      }
    });
    map.on('moveend', () => {
      const center = map.getCenter();
      useAppStore.getState().setCameraCenter([center.lng, center.lat]);
      // Nouvelle fenêtre visible : rafraîchir en priorité ce qui est à l'écran.
      const state = useAppStore.getState();
      applyMetrics(map, state.metricsData, RECIT_KEY, true);
      for (const layer of state.freeNavLayers) {
        const data = freeDataRef.current.get(layer.id);
        if (data) applyMetrics(map, data, freeStateKey(layer.id), true);
      }
    });

    const onClick = (event: MapLayerMouseEvent): void => {
      // Règle de sélection : la première feature de la couche communes au
      // point cliqué (ordre de rendu MapLibre). Aucun repli « plus proche » :
      // sans feature ou sans code, rien n'est sélectionné.
      const feature = event.features?.[0];
      const props = feature?.properties;
      if (!props) return;
      const code = typeof props.code_insee === 'string' ? props.code_insee : null;
      if (!code) return;
      const nom = typeof props.nom === 'string' ? props.nom : null;
      const bbox = geometryBbox(feature.geometry as { coordinates?: unknown });
      if (GEO_DEBUG) {
        console.info('[geo] clic commune', {
          point: [event.point.x, event.point.y],
          lngLat: [event.lngLat.lng, event.lngLat.lat],
          layer: FILL_LAYER,
          candidates: event.features?.length ?? 0,
          code,
          nom,
          bbox,
        });
      }
      useAppStore.getState().selectCommune(code, nom, bbox);
    };
    map.on('click', FILL_LAYER, onClick);
    map.on('mousemove', FILL_LAYER, (event: MapLayerMouseEvent) => {
      const props = event.features?.[0]?.properties;
      const code = typeof props?.code_insee === 'string' ? props.code_insee : null;
      if (!code) {
        setTooltip(null);
        return;
      }
      const state = useAppStore.getState();
      const lines: string[] = [];
      const recitPoint = state.metricsData.get(code);
      if (recitPoint) lines.push(`${INDICATOR_LABELS[state.indicator]} — ${hoverLine(state.indicator, recitPoint)}`);
      for (const layer of state.freeNavLayers) {
        const point = freeDataRef.current.get(layer.id)?.get(code);
        if (point) lines.push(`${INDICATOR_LABELS[layer.indicator]} (${layer.year}) — ${hoverLine(layer.indicator, point)}`);
      }
      setTooltip({
        x: event.point.x,
        y: event.point.y,
        title: typeof props?.nom === 'string' ? props.nom : code,
        lines,
      });
    });
    map.on('mousemove', DEPT_FILL, (event: MapLayerMouseEvent) => {
      const dept = typeof event.features?.[0]?.id === 'string' ? event.features[0].id : null;
      if (!dept) return;
      const point = deptDataRef.current.get(dept);
      if (!point) return;
      const state = useAppStore.getState();
      setTooltip({
        x: event.point.x,
        y: event.point.y,
        title: (typeof event.features?.[0]?.properties?.nom === 'string' ? `${event.features[0].properties.nom} (${dept})` : `Department ${dept}`),
        lines: [
          `${INDICATOR_LABELS[state.indicator]} — ${hoverLine(state.indicator, point)} (departmental average)`,
          'Zoom in for municipality-level detail',
        ],
      });
    });
    map.on('mouseleave', DEPT_FILL, () => setTooltip(null));
    map.on('mouseenter', DEPT_FILL, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', DEPT_FILL, () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('click', DEPT_FILL, (event: MapLayerMouseEvent) => {
      // Conflit d'échelles : à proximité du seuil communal, la couche
      // commune a priorité — le clic ne doit pas déclencher un vol
      // départemental centré sur le point cliqué (cause du « zoom faux »).
      if (map.getZoom() >= LOD_ZOOM - 0.05) return;
      const communes = map.queryRenderedFeatures(event.point, { layers: [FILL_LAYER] });
      if (communes.length > 0) return;
      const bbox = geometryBbox(event.features?.[0]?.geometry as { coordinates?: unknown } | undefined);
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (bbox) {
        map.fitBounds(bbox, {
          padding: 48,
          maxZoom: 9,
          pitch: 0,
          bearing: 0,
          duration: reduceMotion ? 0 : 1400,
          essential: true,
        });
      }
    });
    map.on('click', REG_FILL, (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const code = typeof feature?.properties?.code === 'string' ? feature.properties.code : null;
      const nom = typeof feature?.properties?.nom === 'string' ? feature.properties.nom : null;
      if (!code || !nom) return;
      useAppStore.getState().setSelectedRegion({ code, nom });
      if (map.getLayer(REG_SELECTED)) {
        map.setFilter(REG_SELECTED, ['==', ['get', 'code'], code]);
      }
      const bbox = geometryBbox(feature?.geometry as { coordinates?: unknown });
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (bbox) {
        map.fitBounds(bbox, {
          padding: 48,
          maxZoom: 8.2,
          pitch: 0,
          bearing: 0,
          duration: reduceMotion ? 0 : 1400,
          essential: true,
        });
      }
    });
    map.on('mouseleave', FILL_LAYER, () => setTooltip(null));
    map.on('mouseenter', FILL_LAYER, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', FILL_LAYER, () => {
      map.getCanvas().style.cursor = '';
    });

    };
    void demarrer();
    return () => {
      annule = true;
      if (applyFrameRef.current !== null) cancelAnimationFrame(applyFrameRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
      maplibregl.removeProtocol('pmtiles');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Récit : données + palette + opacité ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setPaintProperty(FILL_LAYER, 'fill-color', paletteColorExpression(indicator, RECIT_KEY) as never);
    applyMetrics(map, metricsData, RECIT_KEY, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricsData, indicator, mapReady]);

  /* ---------- Niveau régional : limites et sélection régionales ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const visibility = currentLevel === 'regional' ? 'visible' : 'none';
    for (const id of [REG_FILL, REG_CONTOUR, REG_SELECTED]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    }
    if (map.getLayer(REG_SELECTED)) {
      map.setFilter(REG_SELECTED, ['==', ['get', 'code'], selectedRegion?.code ?? '']);
    }
  }, [currentLevel, selectedRegion, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    // Carte neutre avant le choix d'entrée : aucune nappe colorée.
    map.setPaintProperty(FILL_LAYER, 'fill-opacity', (entered ? zoomOpacity(recitLayerOpacity) : 0) as never);
    if (map.getLayer(DEPT_FILL)) {
      map.setPaintProperty(DEPT_FILL, 'fill-opacity', entered ? 0.85 : 0);
    }
  }, [recitLayerOpacity, mapReady, entered]);

  /* ---------- Niveau national : moyennes départementales ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !entered) return;
    map.setPaintProperty(DEPT_FILL, 'fill-color', paletteColorExpression(indicator, RECIT_KEY) as never);
    let cancelled = false;
    void duckdbService
      .queryDepartementMetrics(scenario, indicator, year)
      .then(({ metrics }) => {
        if (cancelled || !mapRef.current) return;
        deptDataRef.current = metrics;
        for (const [dept, point] of metrics) {
          mapRef.current?.setFeatureState({ source: DEPT_SOURCE, id: dept }, { [RECIT_KEY]: point.composite });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scenario, indicator, year, mapReady, entered]);

  /* ---------- Couches libres : fetch isolé, calques, ordre ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const labelAnchor = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    const alive = new Set(freeNavLayers.map((l) => l.id));

    for (const layer of freeNavLayers) {
      const layerId = freeLayerId(layer.id);
      if (!map.getLayer(layerId)) {
        map.addLayer(
          {
            id: layerId,
            type: 'fill',
            source: SOURCE_ID,
            'source-layer': SOURCE_LAYER,
            minzoom: LOD_ZOOM,
            paint: {
              'fill-color': paletteColorExpression(layer.indicator, freeStateKey(layer.id)) as never,
              'fill-opacity': zoomOpacity(layer.opacity) as never,
            },
          },
          labelAnchor,
        );
      } else {
        map.setPaintProperty(layerId, 'fill-color', paletteColorExpression(layer.indicator, freeStateKey(layer.id)) as never);
        map.setPaintProperty(layerId, 'fill-opacity', zoomOpacity(layer.opacity) as never);
      }
      void duckdbService
        .queryMetrics(layer.scenario, layer.indicator, layer.year)
        .then(({ metrics }) => {
          freeDataRef.current.set(layer.id, metrics);
          if (mapRef.current) applyMetrics(mapRef.current, metrics, freeStateKey(layer.id), true);
        })
        .catch(() => undefined);
    }

    // Retirer les calques des couches supprimées.
    for (const styleLayer of [...map.getStyle().layers]) {
      if (styleLayer.id.startsWith('free-fill-')) {
        const storeId = styleLayer.id.replace('free-fill-', '');
        if (!alive.has(storeId) && map.getLayer(styleLayer.id)) {
          map.removeLayer(styleLayer.id);
          freeDataRef.current.delete(storeId);
        }
      }
    }

    // Ordre d'empilement : récit au-dessus ou en dessous, contours/bâti épinglés au sommet.
    const freeBottomToTop = [...freeNavLayers].reverse().map((l) => freeLayerId(l.id));
    const dataOrder = recitOnTop ? [...freeBottomToTop, FILL_LAYER] : [FILL_LAYER, ...freeBottomToTop];
    for (const id of dataOrder) {
      if (map.getLayer(id)) map.moveLayer(id, labelAnchor);
    }
    for (const id of [BUILDING_BASE, BUILDING_3D, BUILDING_BORDER, CONTOUR_LAYER, SELECTED_LAYER]) {
      if (map.getLayer(id)) map.moveLayer(id, labelAnchor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeNavLayers, recitOnTop, mapReady]);

  /* ---------- Sélecteur de finesse : zoom <-> niveau, vols demandés ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const syncLevel = (): void => {
      const zoom = map.getZoom();
      // Bandes : national = vue France départementale ; régional = limites
      // régionales visibles dès que la France tient à l'écran (~6,2) ;
      // communal au-delà de 12. Le seuil LOD_ZOOM (7,5) ne régit que
      // l'échange nappe départementale / communes, pas le niveau affiché.
      const level = zoom < 6.2 ? 'national' : zoom < 12 ? 'regional' : 'communal';
      if (useAppStore.getState().currentLevel !== level) useAppStore.getState().setLevel(level);
    };
    syncLevel();
    map.on('zoomend', syncLevel);
    return () => {
      map.off('zoomend', syncLevel);
    };
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !cameraIntent) return;
    const pitch = currentLevel === 'national' ? 20 : currentLevel === 'regional' ? 35 : 45;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.flyTo({
      center: cameraIntent.center,
      zoom: cameraIntent.zoom,
      pitch,
      bearing: currentLevel === 'communal' ? -15 : -8,
      duration: reduceMotion ? 0 : 2000,
      essential: true,
    });
  }, [cameraIntent, mapReady]); // currentLevel lu au moment du vol via l'état ci-dessus

  /* ---------- Commune sélectionnée : contour + vol urbain ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer(SELECTED_LAYER)) return;
    map.setFilter(SELECTED_LAYER, ['==', ['get', 'code_insee'], selectedCommune ?? '']);
  }, [selectedCommune, mapReady]);

  /* Caméra de sélection : priorité à la géométrie réellement cliquée.
     La commune affichée, la fiche et le cadrage désignent la même feature. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selectedFeatureBbox) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.fitBounds(selectedFeatureBbox, {
      padding: window.innerWidth >= 1280
        ? { right: 430, top: 90, bottom: 110, left: 24 }
        : { top: 70, bottom: 90 },
      maxZoom: 14.2,
      pitch: 40,
      bearing: -15,
      duration: reduceMotion ? 0 : 1800,
      essential: true,
    });
  }, [selectedFeatureBbox, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !communeProfile) return;
    // Sélection sans géométrie cliquée (ouverture programmatique) :
    // repli sur le centroïde du référentiel, qui est celui du polygone.
    if (useAppStore.getState().selectedFeatureBbox) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.flyTo({
      center: [communeProfile.lon, communeProfile.lat],
      zoom: 13.8,
      pitch: 45,
      bearing: -15,
      // La fiche occupe la droite : cadrer la commune dans l'espace libre.
      padding: window.innerWidth >= 1280 ? { right: 430, top: 90, bottom: 110, left: 24 } : { top: 70, bottom: 90 },
      duration: reduceMotion ? 0 : 2200,
      essential: true,
    });
  }, [communeProfile, mapReady]);

  /* ---------- Caméra récit (cadrage par chapitre) ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || mode !== 'STORY') return;
    const stepDef = STORY_STEPS[storyStep];
    if (!stepDef) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.flyTo({
      center: stepDef.camera.center,
      zoom: stepDef.camera.zoom,
      pitch: stepDef.camera.pitch,
      bearing: stepDef.camera.bearing,
      // Le panneau récit occupe la gauche : cadrer le sujet dans l'espace libre.
      padding: window.innerWidth >= 1024 ? { left: 424, top: 90, right: 24, bottom: 110 } : { top: 70, bottom: 90 },
      duration: reduceMotion ? 0 : 2600,
      essential: true,
    });
  }, [storyStep, mode, mapReady]);

  // Aucun voile graphique global lié à l'année ou à la trajectoire :
  // la couleur de la carte ne dépend que des données de la couche active.

  return (
    <div className="fixed inset-0 z-0 bg-slate-200" aria-label="Map of French municipalities in their European context">
      <div ref={containerRef} className="h-full w-full" />
      {tooltip && tooltip.lines.length > 0 && (
        <div
          className="glass-panel pointer-events-none absolute z-10 max-w-72 rounded-xl px-3 py-2"
          style={{ left: Math.min(tooltip.x + 14, window.innerWidth - 300), top: tooltip.y + 14 }}
          role="status"
        >
          <p className="text-sm font-bold text-slate-900">{tooltip.title}</p>
          {tooltip.lines.map((line) => (
            <p key={line} className="mt-0.5 text-xs leading-snug text-slate-600">{line}</p>
          ))}
        </div>
      )}
      {selectedRegion && currentLevel === 'regional' && (
        <div
          role="status"
          className="glass-chip absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-full py-1.5 pr-1.5 pl-4"
        >
          <p className="text-xs font-medium whitespace-nowrap text-slate-700">
            Region: <span className="font-semibold text-slate-900">{selectedRegion.nom}</span>
            <span className="text-slate-400"> · zoom in for municipalities</span>
          </p>
          <button
            type="button"
            onClick={() => useAppStore.getState().setSelectedRegion(null)}
            className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-200"
          >
            Clear
          </button>
        </div>
      )}
      {basemapDegraded && !mapError && (
        <div
          role="status"
          className="glass-chip absolute left-1/2 top-24 max-w-md -translate-x-1/2 rounded-full px-3.5 py-1.5 text-center"
        >
          <p className="text-xs font-medium text-slate-600">
            External basemap unavailable — local data remains visible.
          </p>
        </div>
      )}
      {mapError && (
        <div
          role="alert"
          className="glass-panel absolute left-1/2 top-24 max-w-md -translate-x-1/2 rounded-2xl px-4 py-3 text-center"
        >
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Map unavailable</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            The map could not be loaded. Check your connection and reload the page.
          </p>
        </div>
      )}
    </div>
  );
}
