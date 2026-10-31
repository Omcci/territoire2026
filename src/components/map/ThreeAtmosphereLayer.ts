import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl';
import * as THREE from 'three';
import type { Scenario } from '../../lib/metricsTypes';

/**
 * Voile atmosphérique Three.js synchronisé avec MapLibre.
 *
 * Quad plein écran en espace clip : voile diffus en haut du viewport,
 * dont la chaleur (lueur ambrée → braise) croît avec l'année et la
 * sévérité du scénario. Aucun objet 3D posé au sol : l'effet reste
 * un « horizon » qui surchauffe graduellement entre 1990 et 2100.
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uHeat;
uniform float uTime;
void main() {
  float horizon = pow(vUv.y, 2.1);
  float breathe = 0.97 + 0.03 * sin(uTime * 0.35);
  vec3 cool = vec3(0.10, 0.16, 0.28);
  vec3 warm = vec3(0.85, 0.38, 0.12);
  vec3 ember = vec3(0.62, 0.10, 0.08);
  vec3 tint = mix(cool, warm, clamp(uHeat * 1.4, 0.0, 1.0));
  tint = mix(tint, ember, clamp(uHeat - 0.55, 0.0, 1.0) * horizon);
  float alpha = horizon * (0.05 + uHeat * 0.30) * breathe;
  // Léger assombrissement froid en bas pour ancrer la carte.
  float ground = (1.0 - vUv.y) * 0.05 * (1.0 - uHeat);
  gl_FragColor = vec4(mix(tint, vec3(0.02, 0.03, 0.06), ground * 8.0), max(alpha, ground));
}
`;

/** Chaleur atmosphérique 0..1 selon l'horizon et le scénario. */
export function atmosphereHeat(year: number, scenario: Scenario): number {
  const t = Math.min(1, Math.max(0, (year - 1990) / 110));
  const factor = scenario === 'ssp585' ? 1 : scenario === 'ssp245' ? 0.62 : 0.34;
  return Math.min(1, t * factor + 0.04);
}

export interface AtmosphereLayerHandle {
  layer: CustomLayerInterface;
  setHeat: (heat: number) => void;
}

export function createThreeAtmosphereLayer(id = 'three-atmosphere'): AtmosphereLayerHandle {
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.OrthographicCamera | null = null;
  let uniforms: { uHeat: { value: number }; uTime: { value: number } } | null = null;
  let mapRef: MapLibreMap | null = null;

  const layer: CustomLayerInterface = {
    id,
    type: 'custom',
    renderingMode: '2d',
    onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
      mapRef = map;
      uniforms = { uHeat: { value: 0.1 }, uTime: { value: 0 } };
      const material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      scene = new THREE.Scene();
      camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: false,
      });
      renderer.autoClear = false;
    },
    render(_gl: WebGL2RenderingContext, _options: unknown) {
      if (!renderer || !scene || !camera || !uniforms) return;
      uniforms.uTime.value = performance.now() / 1000;
      renderer.resetState();
      renderer.render(scene, camera);
    },
    onRemove() {
      scene?.traverse((obj: THREE.Object3D) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m: THREE.Material) => m.dispose());
          else mat.dispose();
        }
      });
      renderer?.dispose();
      renderer = null;
      scene = null;
      camera = null;
      uniforms = null;
      mapRef = null;
    },
  };

  return {
    layer,
    setHeat(heat: number) {
      if (uniforms) uniforms.uHeat.value = heat;
      mapRef?.triggerRepaint();
    },
  };
}
