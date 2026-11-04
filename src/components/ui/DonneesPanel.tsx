import { ArrowLeftRight, Bus, Car, CarFront, Droplets, Euro, Flame, History, House, Landmark, Layers, Lock, Plus, Sigma, Waves, X, type LucideIcon } from 'lucide-react';
import {
  INDICATOR_EXPLANATIONS,
  INDICATOR_LABELS,
  type Indicator,
} from '../../lib/metricsTypes';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/useAppStore';

/**
 * Organisation du catalogue : d'abord les données qui correspondent
 * directement à une source, ensuite les lectures croisées dérivées.
 */
const LAYER_GROUPS: { title: string; note?: string; indicators: Indicator[] }[] = [
  {
    title: 'Simulated climate (demonstration)',
    note: 'Values produced by the project\u2019s demonstration model, not observations.',
    indicators: ['heatwave', 'rga', 'flooding', 'water_stress'],
  },
  {
    title: 'Observed data',
    indicators: ['catnat', 'prix_immo', 'services', 'voiture_menages', 'voiture_travail', 'transports_communs'],
  },
  {
    title: 'Derived indicators',
    note: 'Derived readings that bring together several observed datasets; they do not measure a new risk.',
    indicators: ['cher_expose', 'fragilites'],
  },
];

const INDICATOR_ICONS: Record<Indicator, LucideIcon> = {
  heatwave: Flame,
  rga: House,
  flooding: Waves,
  water_stress: Droplets,
  catnat: History,
  prix_immo: Euro,
  cher_expose: ArrowLeftRight,
  services: Landmark,
  voiture_menages: Car,
  voiture_travail: CarFront,
  transports_communs: Bus,
  fragilites: Sigma,
};

/**
 * Catalogue Données : superposer des couches libres par-dessus la
 * couche principale. Une couche déjà affichée (ou portée par la
 * couche principale) est verrouillée par un cadenas anti-doublon.
 */
export default function DonneesPanel() {
  const open = useAppStore((s) => s.donneesPanelOpen);
  const setOpen = useAppStore((s) => s.setDonneesPanelOpen);
  const addFreeNavLayer = useAppStore((s) => s.addFreeNavLayer);
  const recitIndicator = useAppStore((s) => s.indicator);
  const freeNavLayers = useAppStore((s) => s.freeNavLayers);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(
          'pointer-events-auto flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors',
          open
            ? 'border border-slate-900 bg-slate-900 text-white shadow-md'
            : 'glass-chip text-slate-800 hover:bg-white/70',
        )}
      >
        <Layers className="h-4 w-4" aria-hidden />
        Data
      </button>

      {open && (
        <section
          aria-label="Overlay data catalog"
          className="glass-panel panneau-entree pointer-events-auto absolute right-0 top-12 z-20 max-h-[calc(100vh-5.5rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold tracking-tight text-slate-900">Overlay data layers</h2>
              <p className="mt-0.5 text-xs font-light leading-relaxed text-slate-500">
                Each added layer keeps its own settings, without affecting the main
                layer. Original data come first; derived indicators are readings
                derived from them, labeled as such.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close the catalog"
              className="shrink-0 rounded-full bg-slate-100 p-1.5 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {LAYER_GROUPS.map((group) => (
          <div key={group.title} className="mt-4">
            <h3 className="text-xs font-semibold text-slate-700">{group.title}</h3>
            {group.note && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{group.note}</p>}
          <ul className="mt-1">
            {group.indicators.map((indicator) => {
              const inRecit = recitIndicator === indicator;
              const alreadyAdded = freeNavLayers.some((l) => l.indicator === indicator);
              const locked = inRecit || alreadyAdded;
              return (
                <li
                  key={indicator}
                  className="flex items-center gap-3 border-t border-slate-900/10 px-1 py-3 first:border-t-0"
                >
                  {(() => {
                    const Icon = INDICATOR_ICONS[indicator];
                    return <Icon className="h-5 w-5 shrink-0 text-slate-500" aria-hidden strokeWidth={1.75} />;
                  })()}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">{INDICATOR_LABELS[indicator]}</p>
                    <p className="truncate text-xs font-light text-slate-500">
                      {INDICATOR_EXPLANATIONS[indicator]}
                    </p>
                    {locked && (
                      <p className="mt-0.5 text-[11px] font-medium text-amber-600">
                        {inRecit ? 'Already shown as the main layer' : 'Already added to the map'}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => addFreeNavLayer(indicator)}
                    aria-label={
                      locked
                        ? `${INDICATOR_LABELS[indicator]} already displayed`
                        : `Add ${INDICATOR_LABELS[indicator]} as an overlay`
                    }
                    className={cn(
                      'flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                      locked
                        ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                        : 'bg-slate-900 text-white hover:bg-slate-700',
                    )}
                  >
                    {locked ? <Lock className="h-3.5 w-3.5" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
                    {locked ? 'Displayed' : 'Add'}
                  </button>
                </li>
              );
            })}
          </ul>
          </div>
          ))}
        </section>
      )}
    </>
  );
}
