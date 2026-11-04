import { create } from 'zustand';
import { STORY_STEPS, openingState, type EntryChoice } from '../components/story/steps';
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

export { STORY_STEPS };
export type { StoryStep } from '../components/story/steps';

export type MetricsStatus = 'idle' | 'loading' | 'ready' | 'error';
export type HistoryStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SeasonKey = 'annuel' | 'ete' | 'hiver';
export type FinesseLevel = 'national' | 'regional' | 'communal';

export interface CameraIntent {
  center: [number, number];
  zoom: number;
  nonce: number;
}

/**
 * Couche libre ajoutée depuis le panneau Données.
 * État 100 % isolé : year/scenario/opacity locaux, jamais synchronisés
 * avec le Récit ni avec le TimelineDock (règle d'or anti-conflit).
 */
export interface FreeNavLayerInstance {
  id: string;
  indicator: Indicator;
  opacity: number;
  year: number;
  scenario: Scenario;
}

let freeLayerSeq = 0;

interface AppState {
  /* ---- Entrée : carte neutre tant que l'utilisateur n'a pas choisi ---- */
  entryChoice: EntryChoice;

  /* ---- Récit (piloté exclusivement par le TimelineDock) ---- */
  mode: AppMode;
  scenario: Scenario;
  indicator: Indicator;
  year: number;
  recitSeason: SeasonKey;
  storyStep: number;
  /** Opacité de la nappe récit au sol (slider de sa carte de légende). */
  recitLayerOpacity: number;
  /** Vrai = la couche récit repasse au-dessus des couches libres. */
  recitOnTop: boolean;

  /* ---- Données récit chargées ---- */
  metricsData: MetricsMap;
  metricsStatus: MetricsStatus;
  metricsError: string | null;
  lastQueryMs: number | null;
  duckdbReady: boolean;

  /* ---- Navigation libre (catalogue Données) ---- */
  freeNavLayers: FreeNavLayerInstance[];
  donneesPanelOpen: boolean;

  /* ---- Sélecteur de finesse (National / Régional / Communal) ---- */
  currentLevel: FinesseLevel;
  cameraIntent: CameraIntent | null;

  /* ---- Commune inspectée ---- */
  selectedCommune: string | null;
  selectedCommuneName: string | null;
  communeProfile: CommuneProfile | null;
  communeHistory: CommuneHistoryRow[] | null;
  historyStatus: HistoryStatus;
  historyError: string | null;

  enterStories: () => void;
  enterExplore: () => void;
  closeWelcome: () => void;
  setMode: (mode: AppMode) => void;
  setScenario: (scenario: Scenario) => void;
  setIndicator: (indicator: Indicator) => void;
  setYear: (year: number) => void;
  setRecitSeason: (season: SeasonKey) => void;
  refreshMetrics: () => Promise<void>;
  selectCommune: (codeInsee: string | null, nom?: string | null, bbox?: [number, number, number, number] | null) => void;
  loadCommuneHistory: (codeInsee: string) => Promise<void>;
  loadCommuneProfile: (codeInsee: string) => Promise<void>;
  setStoryStep: (index: number) => void;
  nextStoryStep: () => void;
  prevStoryStep: () => void;

  setRecitLayerOpacity: (opacity: number) => void;
  setRecitOnTop: (onTop: boolean) => void;
  setDonneesPanelOpen: (open: boolean) => void;
  addFreeNavLayer: (indicator: Indicator) => void;
  removeFreeNavLayer: (id: string) => void;
  setFreeNavLayerParam: (id: string, updates: Partial<Omit<FreeNavLayerInstance, 'id'>>) => void;
  reorderFreeNavLayers: (orderedIds: string[]) => void;
  /** La couche est verrouillée si elle doublonne le récit ou une couche libre. */
  isIndicatorLocked: (indicator: Indicator) => boolean;

  setLevel: (level: FinesseLevel) => void;
  flyToLevel: (zoom: number, center: [number, number]) => void;
  selectedFeatureBbox: [number, number, number, number] | null;
  selectedRegion: { code: string; nom: string } | null;
  setSelectedRegion: (region: { code: string; nom: string } | null) => void;
  cameraCenter: [number, number];
  setCameraCenter: (center: [number, number]) => void;
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
      // Précharge les horizons voisins en tâche de fond (slider fluide).
      duckdbService.prefetchAdjacentYears(scenario, indicator, year);
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
        // Le nom réel cliqué (carte) prime : le profil aliasé d'une grande
        // ville porte le nom du code métrique, pas celui de l'arrondissement.
        set({
          communeProfile: profile,
          selectedCommuneName:
            profile.codeInsee === codeInsee ? profile.nom : get().selectedCommuneName,
        });
      }
    } catch {
      // Le nom issu de la carte reste affiché ; le profil est optionnel.
    }
  };

  const applyStoryStep = (index: number): void => {
    const step = STORY_STEPS[index];
    if (!step) return;
    set({
      entryChoice: 'story',
      storyStep: index,
      mode: 'STORY',
      scenario: step.defaultScenario,
      indicator: step.layer,
      year: step.defaultYear,
      // Changement de chapitre : fermer la fiche commune (bug Paris/Bordeaux,
      // la fiche de l'ancienne commune ne doit jamais survivre au récit).
      selectedCommune: null,
      selectedCommuneName: null,
      communeProfile: null,
      communeHistory: null,
      historyStatus: 'idle',
      historyError: null,
      donneesPanelOpen: false,
    });
    void refreshMetrics();
  };

  const opening = openingState();

  return {
    entryChoice: opening.entryChoice,
    mode: opening.mode,
    scenario: opening.scenario,
    indicator: opening.indicator,
    year: opening.year,
    recitSeason: 'annuel',
    storyStep: opening.storyStep,
    recitLayerOpacity: 0.85,
    recitOnTop: true,

    metricsData: new Map(),
    metricsStatus: 'idle',
    metricsError: null,
    lastQueryMs: null,
    duckdbReady: false,

    freeNavLayers: [],
    donneesPanelOpen: false,
    currentLevel: 'national',
    cameraIntent: null,

    selectedCommune: null,
    selectedCommuneName: null,
    communeProfile: null,
    communeHistory: null,
    historyStatus: 'idle',
    historyError: null,

    enterStories: () => {
      set({ entryChoice: 'story' });
      applyStoryStep(0);
    },
    enterExplore: () => {
      set({ entryChoice: 'explore', mode: 'EXPLORE' });
      void refreshMetrics();
    },
    closeWelcome: () => set({ entryChoice: 'closed' }),
    setMode: (mode) =>
      set((st) => ({
        mode,
        entryChoice:
          mode === 'STORY' ? 'story' : st.entryChoice === 'pending' ? 'explore' : st.entryChoice,
      })),
    setScenario: (scenario) => {
      // Choisir une donnée depuis la carte neutre vaut entrée en Exploration.
      if (get().entryChoice === 'pending' || get().entryChoice === 'closed') {
        set({ entryChoice: 'explore', mode: 'EXPLORE' });
      }
      set({ scenario });
      void refreshMetrics();
    },
    setIndicator: (indicator) => {
      if (get().entryChoice === 'pending' || get().entryChoice === 'closed') {
        set({ entryChoice: 'explore', mode: 'EXPLORE' });
      }
      set({ indicator });
      void refreshMetrics();
    },
    setYear: (year) => {
      if (!PIVOT_YEARS.includes(year)) return;
      if (get().entryChoice === 'pending' || get().entryChoice === 'closed') {
        set({ entryChoice: 'explore', mode: 'EXPLORE' });
      }
      set({ year });
      void refreshMetrics();
    },
    setRecitSeason: (recitSeason) => set({ recitSeason }),
    refreshMetrics,
    selectedFeatureBbox: null,
    selectCommune: (codeInsee, nom, bbox) => {
      set({
        selectedCommune: codeInsee,
        selectedCommuneName: nom ?? null,
        selectedFeatureBbox: codeInsee ? (bbox ?? null) : null,
        communeProfile: null,
        // La fiche commune remplace le catalogue : jamais de superposition.
        donneesPanelOpen: false,
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

    setRecitLayerOpacity: (recitLayerOpacity) =>
      set({ recitLayerOpacity: Math.min(1, Math.max(0, recitLayerOpacity)) }),
    setRecitOnTop: (recitOnTop) =>
      set(recitOnTop ? { recitOnTop: true, recitLayerOpacity: 1 } : { recitOnTop: false }),
    setDonneesPanelOpen: (donneesPanelOpen) => set({ donneesPanelOpen }),

    isIndicatorLocked: (indicator) => {
      const s = get();
      return s.indicator === indicator || s.freeNavLayers.some((l) => l.indicator === indicator);
    },
    addFreeNavLayer: (indicator) => {
      if (get().isIndicatorLocked(indicator)) return; // cadenas anti-doublon
      freeLayerSeq += 1;
      const { year, scenario } = get();
      set((s) => ({
        freeNavLayers: [
          { id: `libre-${indicator}-${freeLayerSeq}`, indicator, opacity: 0.8, year, scenario },
          ...s.freeNavLayers,
        ],
        recitOnTop: false, // toute nouvelle couche passe au-dessus du récit
      }));
    },
    removeFreeNavLayer: (id) =>
      set((s) => ({ freeNavLayers: s.freeNavLayers.filter((l) => l.id !== id) })),
    setFreeNavLayerParam: (id, updates) =>
      set((s) => ({
        // Isolation stricte : seul cet item change, récit et dock intacts.
        freeNavLayers: s.freeNavLayers.map((l) => (l.id === id ? { ...l, ...updates } : l)),
      })),
    reorderFreeNavLayers: (orderedIds) =>
      set((s) => ({
        freeNavLayers: orderedIds
          .map((id) => s.freeNavLayers.find((l) => l.id === id))
          .filter((l): l is FreeNavLayerInstance => l !== undefined),
      })),

    selectedRegion: null,
    setSelectedRegion: (selectedRegion) => set({ selectedRegion }),
    cameraCenter: [2.3522, 48.8566],
    setCameraCenter: (cameraCenter) => set({ cameraCenter }),
    setLevel: (currentLevel) => set({ currentLevel }),
    flyToLevel: (zoom, center) =>
      set((s) => ({
        cameraIntent: { center, zoom, nonce: (s.cameraIntent?.nonce ?? 0) + 1 },
      })),
  };
});
