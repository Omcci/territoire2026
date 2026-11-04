import { useEffect, useRef, useState } from 'react';
import { CalendarClock, ChevronDown } from 'lucide-react';
import { PIVOT_YEARS, type Indicator } from '../../lib/metricsTypes';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/useAppStore';

/** Couches observées : aucun horizon projeté, la frise ne doit pas en suggérer un. */
const OBSERVED_INDICATORS: ReadonlySet<Indicator> = new Set(['catnat', 'prix_immo', 'cher_expose', 'services', 'voiture_menages', 'voiture_travail', 'transports_communs', 'fragilites']);

/**
 * Frise des horizons (Exploration, couches simulées uniquement).
 * Fermée : un bouton compact indiquant l'horizon sélectionné.
 * Ouverte : les horizons disponibles, sans lecture automatique.
 * Elle ne règle que les données affichées — jamais un effet visuel
 * global sur la carte. Pour les données observées à millésime unique,
 * elle n'apparaît pas : la période réelle est dans la légende.
 */
export default function TimelineDock() {
  const mode = useAppStore((s) => s.mode);
  const indicator = useAppStore((s) => s.indicator);
  const year = useAppStore((s) => s.year);
  const setYear = useAppStore((s) => s.setYear);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Repli au clic extérieur.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open ]);

  // Une couche observée ou le mode Récit referme la frise.
  useEffect(() => {
    setOpen(false);
  }, [indicator, mode]);

  if (mode !== 'EXPLORE') return null;
  if (OBSERVED_INDICATORS.has(indicator)) return null;

  return (
    <div ref={rootRef} className="pointer-events-none fixed bottom-6 left-[3.25rem] z-30 select-none sm:left-14">
      {open ? (
        <div className="glass-panel frise-entree pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-3">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-slate-700" id="frise-horizons-label">
              Simulation horizon
            </p>
            <div className="flex items-center gap-1" role="group" aria-labelledby="frise-horizons-label">
              {PIVOT_YEARS.map((y) => (
                <button
                  key={y}
                  type="button"
                  aria-pressed={y === year}
                  onClick={() => {
                    setYear(y);
                    setOpen(false);
                  }}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                    y === year
                      ? 'bg-slate-900 font-semibold text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900',
                  )}
                >
                  {y}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              Only the layer&apos;s simulated values change. No global visual effect.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close the time horizons"
            className="shrink-0 rounded-full bg-slate-100 p-1.5 text-slate-500 transition-colors hover:bg-slate-200"
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-label={`Current horizon ${year} — Open the time horizons`}
          className="glass-chip pointer-events-auto flex items-center gap-2 rounded-full py-2 pl-3 pr-3.5 transition-colors hover:bg-white/70"
        >
          <CalendarClock className="h-4 w-4 text-slate-500" aria-hidden />
          <span className="text-xs font-medium text-slate-600">Horizon</span>
          <span className="font-mono text-sm font-bold tabular-nums text-slate-900">{year}</span>
        </button>
      )}
    </div>
  );
}
