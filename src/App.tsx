import { Loader2, TriangleAlert } from 'lucide-react';
import HybridMap3D from './components/map/HybridMap3D';
import StoryPanel from './components/story/StoryPanel';
import DonneesPanel from './components/ui/DonneesPanel';
import FinesseSelector from './components/ui/FinesseSelector';
import ModeSwitch from './components/ui/ModeSwitch';
import ExecutiveBriefModal from './components/ui/ExecutiveBriefModal';
import FreeNavLegendStack from './components/ui/FreeNavLegendStack';
import TimelineDock from './components/ui/TimelineDock';
import WelcomeOverlay from './components/ui/WelcomeOverlay';
import { useAppStore } from './store/useAppStore';

export default function App() {
  const metricsStatus = useAppStore((s) => s.metricsStatus);
  const metricsError = useAppStore((s) => s.metricsError);
  const entryChoice = useAppStore((s) => s.entryChoice);

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-100 font-sans text-slate-100">
      {/* Carte 3D plein écran, France replacée dans l'Europe */}
      <HybridMap3D />

      {/* Calque flottant : aucun bandeau horizontal. Marque en pastille
          ancrée en haut à gauche, rail vertical de contrôles contextuels
          sur le bord gauche, bouton Données flottant en haut à droite. */}
      <div className="pointer-events-none fixed inset-0 z-10">
        <div className="glass-chip pointer-events-auto absolute left-4 top-4 rounded-2xl py-2 pl-4 pr-3 text-slate-800 max-sm:left-3 max-sm:top-3">
          <h1 className="whitespace-nowrap text-[13px] font-extrabold leading-none tracking-tight text-slate-900 max-sm:text-[11px]">
            TERRITOIRES 2100
          </h1>
          <p className="mt-1 text-[10px] leading-none text-slate-600 max-sm:hidden">
            French Republic · Ecological Transition
          </p>
        </div>

        <nav
          aria-label="Map controls"
          className="absolute left-4 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2 max-sm:left-3 max-sm:top-24 max-sm:translate-y-0"
        >
          <FinesseSelector />
          <ModeSwitch />
        </nav>

        <div className="absolute right-4 top-4 max-sm:right-3 max-sm:top-3">
          <DonneesPanel />
        </div>

        {/* Chargement des données climatiques (état réel du store) */}
        {metricsStatus === 'loading' && (
          <div
            role="status"
            className="glass-chip pointer-events-auto absolute left-1/2 top-20 flex -translate-x-1/2 items-center gap-2 rounded-full py-2 pl-3 pr-4"
          >
            <Loader2 className="h-4 w-4 animate-spin text-slate-600" aria-hidden />
            <p className="text-xs font-medium text-slate-600">
              Loading climate data for 35,000 municipalities…
            </p>
          </div>
        )}

        {/* Invitation d'entrée sur carte neutre */}
        <WelcomeOverlay />

        {/* Panneau récit éditorial (mode Récit) */}
        <StoryPanel />

        {/* Pile de légendes unifiée, à droite — masquée tant que le choix
            d'entrée est en attente : aucun indicateur ne doit sembler actif
            sur la carte neutre d'ouverture. */}
        {entryChoice !== 'pending' && <FreeNavLegendStack />}

        {/* Erreur de chargement, en langage clair */}
        {metricsStatus === 'error' && metricsError && (
          <div
            role="alert"
            className="glass-panel pointer-events-auto absolute bottom-40 left-4 flex max-w-sm items-start gap-2 rounded-2xl px-4 py-3 sm:bottom-44"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
            <p className="text-sm leading-relaxed text-slate-700">
              Climate data could not be loaded. Check your connection, then reload the page.
            </p>
          </div>
        )}
      </div>

      {/* Fiche commune + dock temporel (même règle d'ouverture neutre) */}
      <ExecutiveBriefModal />
      {entryChoice !== 'pending' && <TimelineDock />}
    </div>
  );
}
