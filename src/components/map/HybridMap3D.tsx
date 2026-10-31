import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type {
  Map as MapLibreMap,
  MapLayerMouseEvent,
  StyleSpecification,
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAppStore, STORY_STEPS } from '../../store/useAppStore';
import { atmosphereHeat, createThreeAtmosphereLayer } from './ThreeAtmosphereLayer';

const SOURCE_ID = 'communes';
const SOURCE_LAYER = 'communes';
const EXTRUSION_LAYER = 'communes-extrusion';
const OUTLINE_LAYER = 'communes-outline';
const SELECTED_LAYER = 'communes-selected';

/** Style sombre neutre : aucun fond commercial, seules les communes PMTiles. */
const MAP_STYLE: StyleSpecification = {
  version: 8,
  name: 'Territoires 2100 — sombre',
  sources: {
    [SOURCE_ID]: {
      type: 'vector',
      url: 'pmtiles:///france_communes.pmtiles',
      promoteId: { [SOURCE_LAYER]: 'code_insee' },
      attribution: 'Territoires 2100 (démo synthétique)',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#070b12' } },
    {
      id: EXTRUSION_LAYER,
      type: 'fill-extrusion',
      source: SOURCE_ID,
      'source-layer': SOURCE_LAYER,
      paint: {
        'fill-extrusion-color': [
          'interpolate',
          ['linear'],
          ['coalesce', ['feature-state', 'composite'], 0],
          0, '#1e293b',
          0.35, '#3f4c63',
          0.55, '#b45309',
          0.75, '#9a3412',
          0.9, '#991b1b',
        ],
        // Hauteur proportionnelle au score composite (feature-state DuckDB).
        'fill-extrusion-height': ['coalesce', ['*', ['feature-state', 'composite'], 18000], 0],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.92,
        'fill-extrusion-vertical-gradient': true,
      },
    },
    {
      id: OUTLINE_LAYER,
      type: 'line',
      source: SOURCE_ID,
      'source-layer': SOURCE_LAYER,
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.05, 'line-width': 0.5 },
    },
    {
      id: SELECTED_LAYER,
      type: 'line',
      source: SOURCE_ID,
      'source-layer': SOURCE_LAYER,
      filter: ['==', ['get', 'code_insee'], ''],
      paint: { 'line-color': '#f4f4f5', 'line-opacity': 0.95, 'line-width': 2 },
    },
  ],
};

const APPLY_CHUNK = 6000;

export default function HybridMap3D() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const atmosphereRef = useRef(createThreeAtmosphereLayer());
  const applyFrameRef = useRef<number | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const metricsData = useAppStore((s) => s.metricsData);
  const selectedCommune = useAppStore((s) => s.selectedCommune);
  const storyStep = useAppStore((s) => s.storyStep);
  const mode = useAppStore((s) => s.mode);
  const year = useAppStore((s) => s.year);
  const scenario = useAppStore((s) => s.scenario);

  /* ---- Initialisation unique de la carte ---- */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [2.55, 46.65],
      zoom: 5.3,
      pitch: 42,
      bearing: -8,
      minZoom: 4,
      maxZoom: 13,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-left');

    map.on('load', () => {
      map.addLayer(atmosphereRef.current.layer);
      atmosphereRef.current.setHeat(
        atmosphereHeat(useAppStore.getState().year, useAppStore.getState().scenario),
      );
      setMapReady(true);
    });
    map.on('error', (e) => {
      const message = e.error?.message;
      if (message) setMapError(message);
    });

    const onClick = (event: MapLayerMouseEvent): void => {
      const feature = event.features?.[0];
      const props = feature?.properties;
      if (!props) return;
      const code = typeof props.code_insee === 'string' ? props.code_insee : null;
      if (!code) return;
      const nom = typeof props.nom === 'string' ? props.nom : null;
      useAppStore.getState().selectCommune(code, nom);
    };
    map.on('click', EXTRUSION_LAYER, onClick);
    map.on('mouseenter', EXTRUSION_LAYER, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', EXTRUSION_LAYER, () => {
      map.getCanvas().style.cursor = '';
    });

    return () => {
      if (applyFrameRef.current !== null) cancelAnimationFrame(applyFrameRef.current);
      map.remove();
      mapRef.current = null;
      maplibregl.removeProtocol('pmtiles');
    };
  }, []);

  /* ---- DuckDB -> feature-state, appliqué par tranches (60 FPS) ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || metricsData.size === 0) return;
    if (applyFrameRef.current !== null) cancelAnimationFrame(applyFrameRef.current);
    const entries = [...metricsData.entries()];
    let index = 0;
    const step = (): void => {
      const end = Math.min(entries.length, index + APPLY_CHUNK);
      for (; index < end; index += 1) {
        const entry = entries[index];
        if (!entry) continue;
        const [code, point] = entry;
        map.setFeatureState(
          { source: SOURCE_ID, sourceLayer: SOURCE_LAYER, id: code },
          { composite: point.composite },
        );
      }
      if (index < entries.length) {
        applyFrameRef.current = requestAnimationFrame(step);
      } else {
        applyFrameRef.current = null;
      }
    };
    applyFrameRef.current = requestAnimationFrame(step);
    return () => {
      if (applyFrameRef.current !== null) cancelAnimationFrame(applyFrameRef.current);
    };
  }, [metricsData, mapReady]);

  /* ---- Surbrillance de la commune sélectionnée ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getLayer(SELECTED_LAYER)) return;
    map.setFilter(SELECTED_LAYER, ['==', ['get', 'code_insee'], selectedCommune ?? '']);
  }, [selectedCommune, mapReady]);

  /* ---- Caméra cinématographique du mode Récit ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || mode !== 'STORY') return;
    const stepDef = STORY_STEPS[storyStep];
    if (!stepDef) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.flyTo({
      center: stepDef.camera.center,
      zoom: stepDef.camera.zoom,
      pitch: 55,
      bearing: -10,
      duration: reduceMotion ? 0 : 2600,
      essential: true,
    });
  }, [storyStep, mode, mapReady]);

  /* ---- Voile atmosphérique Three.js : chaleur selon année/scénario ---- */
  useEffect(() => {
    if (!mapReady) return;
    atmosphereRef.current.setHeat(atmosphereHeat(year, scenario));
  }, [year, scenario, mapReady]);

  return (
    <div className="fixed inset-0 z-0 bg-[#070b12]" aria-label="Carte 3D des communes de France">
      <div ref={containerRef} className="h-full w-full" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 65% at 50% 42%, transparent 55%, rgba(0,0,0,0.5) 100%)',
        }}
      />
      {mapError && (
        <div
          role="alert"
          className="absolute left-1/2 top-20 max-w-md -translate-x-1/2 border border-white/10 bg-black/60 px-4 py-3 text-center backdrop-blur-2xl"
        >
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Carte indisponible</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-300">
            {mapError} — vérifiez que <span className="font-mono">france_communes.pmtiles</span> est servi
            (symlink <span className="font-mono">public/</span>) puis rechargez.
          </p>
        </div>
      )}
    </div>
  );
}
