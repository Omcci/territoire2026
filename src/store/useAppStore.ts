import { create } from 'zustand';
import { duckdbService } from '../lib/duckdbService';
import {
  PIVOT_YEARS,
  type AppMode,
  type CommuneHistoryRow,
  type CommuneProfile,
  type Indicator,
  type MetricsMap,
  type Scenario,
} from '../lib/metricsTypes';

export interface CameraState {
  center: [number, number];
  zoom: number;
  pitch: number;
}

export interface StoryStep {
  title: string;
  description: string;
  camera: CameraState;
  scenario: Scenario;
  indicator: Indicator;
  year: number;
}

export const STORY_STEPS: readonly StoryStep[] = [
  {
    title: 'Canicules & Îlots de Chaleur en Île-de-France',
    description: 'Trajectoire SSP5-8.5 : les jours > 35 °C s’envolent sur la métropole parisienne à l’horizon 2050.',
    camera: { center: [2.35, 48.85], zoom: 9.5, pitch: 50 },
    scenario: 'ssp585',
    indicator: 'heatwave',
    year: 2050,
  },
  {
    title: 'Retrait-Gonflement des Argiles en Gironde',
    description: 'Sols argileux du Bordelais : le risque RGA menace le parc de maisons individuelles.',
    camera: { center: [-0.58, 44.84], zoom: 9, pitch: 55 },
    scenario: 'ssp585',
    indicator: 'rga',
    year: 2050,
  },
  {
    title: 'Stress Hydrique Agricole dans le Sud-Ouest',
    description: 'Trajectoire SSP2-4.5 à 2100 : la sécheresse des sols pèse sur les plaines agricoles du bassin toulousain.',
    camera: { center: [1.44, 43.6], zoom: 8, pitch: 45 },
    scenario: 'ssp245',
    indicator: 'water_stress',
    year: 2100,
  },
];

export type MetricsStatus = 'idle' | 'loading' | 'ready' | 'error';
export type HistoryStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AppState {
  mode: AppMode;
  scenario: Scenario;
  indicator: Indicator;
  year: number;
  isPlaying: boolean;
  metricsData: MetricsMap;
  metricsStatus: MetricsStatus;
  metricsError: string | null;
  lastQueryMs: number | null;
  duckdbReady: boolean;
  selectedCommune: string | null;
  selectedCommuneName: string | null;
  communeProfile: CommuneProfile | null;
  communeHistory: CommuneHistoryRow[] | null;
  historyStatus: HistoryStatus;
  historyError: string | null;
  storyStep: number;

  setMode: (mode: AppMode) => void;
  setScenario: (scenario: Scenario) => void;
  setIndicator: (indicator: Indicator) => void;
  setYear: (year: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  refreshMetrics: () => Promise<void>;
  selectCommune: (codeInsee: string | null, nom?: string | null) => void;
  loadCommuneHistory: (codeInsee: string) => Promise<void>;
  loadCommuneProfile: (codeInsee: string) => Promise<void>;
  setStoryStep: (index: number) => void;
  nextStoryStep: () => void;
  prevStoryStep: () => void;
}

let metricsRequestSeq = 0;
let historyRequestSeq = 0;

export const useAppStore = create<AppState>()((set, get) => {
  const refreshMetrics = async (): Promise<void> => {
    const seq = (metricsRequestSeq += 1);
    const { scenario, indicator, year } = get();
    set({ metricsStatus: 'loading', metricsError: null });
    try {
      const { metrics, elapsedMs } = await duckdbService.queryMetrics(scenario, indicator, year);
      if (seq !== metricsRequestSeq) return; // réponse obsolète
      set({
        metricsData: metrics,
        metricsStatus: 'ready',
        lastQueryMs: elapsedMs,
        duckdbReady: true,
      });
    } catch (err: unknown) {
      if (seq !== metricsRequestSeq) return;
      set({
        metricsStatus: 'error',
        metricsError: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const loadCommuneHistory = async (codeInsee: string): Promise<void> => {
    const seq = (historyRequestSeq += 1);
    set({ historyStatus: 'loading', historyError: null, communeHistory: null });
    try {
      const { rows } = await duckdbService.getCommuneHistory(codeInsee);
      if (seq !== historyRequestSeq) return;
      set({ communeHistory: rows, historyStatus: 'ready', duckdbReady: true });
    } catch (err: unknown) {
      if (seq !== historyRequestSeq) return;
      set({
        historyStatus: 'error',
        historyError: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const loadCommuneProfile = async (codeInsee: string): Promise<void> => {
    try {
      const { profile } = await duckdbService.getCommuneProfile(codeInsee);
      if (get().selectedCommune !== codeInsee) return; // sélection déjà changée
      if (profile) {
        set({ communeProfile: profile, selectedCommuneName: profile.nom });
      }
    } catch {
      // Le nom issu des PMTiles reste affiché ; le profil est optionnel.
    }
  };

  const applyStoryStep = (index: number): void => {
    const step = STORY_STEPS[index];
    if (!step) return;
    set({
      storyStep: index,
      mode: 'STORY',
      scenario: step.scenario,
      indicator: step.indicator,
      year: step.year,
      isPlaying: false,
    });
    void refreshMetrics();
  };

  return {
    mode: 'EXPLORE',
    scenario: 'ssp585',
    indicator: 'heatwave',
    year: 2025,
    isPlaying: false,
    metricsData: new Map(),
    metricsStatus: 'idle',
    metricsError: null,
    lastQueryMs: null,
    duckdbReady: false,
    selectedCommune: null,
    selectedCommuneName: null,
    communeProfile: null,
    communeHistory: null,
    historyStatus: 'idle',
    historyError: null,
    storyStep: 0,

    setMode: (mode) => set({ mode }),
    setScenario: (scenario) => {
      set({ scenario });
      void refreshMetrics();
    },
    setIndicator: (indicator) => {
      set({ indicator });
      void refreshMetrics();
    },
    setYear: (year) => {
      if (!PIVOT_YEARS.includes(year)) return;
      set({ year });
      void refreshMetrics();
    },
    setPlaying: (isPlaying) => set({ isPlaying }),
    togglePlaying: () => set((s) => ({ isPlaying: !s.isPlaying })),
    refreshMetrics,
    selectCommune: (codeInsee, nom) => {
      set({
        selectedCommune: codeInsee,
        selectedCommuneName: nom ?? null,
        communeProfile: null,
      });
      if (codeInsee) {
        void loadCommuneHistory(codeInsee);
        void loadCommuneProfile(codeInsee);
      } else {
        set({ communeHistory: null, historyStatus: 'idle', historyError: null });
      }
    },
    loadCommuneHistory,
    loadCommuneProfile,
    setStoryStep: applyStoryStep,
    nextStoryStep: () => applyStoryStep((get().storyStep + 1) % STORY_STEPS.length),
    prevStoryStep: () =>
      applyStoryStep((get().storyStep - 1 + STORY_STEPS.length) % STORY_STEPS.length),
  };
});
