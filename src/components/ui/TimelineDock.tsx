import { useEffect } from 'react';
import {
  BookOpen,
  Compass,
  Droplets,
  Flame,
  Layers,
  Pause,
  Play,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import {
  INDICATORS,
  INDICATOR_LABELS,
  PIVOT_YEARS,
  SCENARIOS,
  SCENARIO_LABELS,
  type Indicator,
  type Scenario,
} from '../../lib/metricsTypes';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/useAppStore';

const INDICATOR_ICONS: Record<Indicator, LucideIcon> = {
  heatwave: Flame,
  rga: Layers,
  flooding: Waves,
  water_stress: Droplets,
};

const PLAY_INTERVAL_MS = 1800;

/** Dock temporel Liquid Glass — îlot flottant centré en bas du viewport. */
export default function TimelineDock() {
  const mode = useAppStore((s) => s.mode);
  const scenario = useAppStore((s) => s.scenario);
  const indicator = useAppStore((s) => s.indicator);
  const year = useAppStore((s) => s.year);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const metricsStatus = useAppStore((s) => s.metricsStatus);
  const lastQueryMs = useAppStore((s) => s.lastQueryMs);
  const setMode = useAppStore((s) => s.setMode);
  const setScenario = useAppStore((s) => s.setScenario);
  const setIndicator = useAppStore((s) => s.setIndicator);
  const setYear = useAppStore((s) => s.setYear);
  const togglePlaying = useAppStore((s) => s.togglePlaying);

  const yearIndex = Math.max(0, PIVOT_YEARS.indexOf(year));

  // Animation timeline : avance d'un horizon pivot toutes les 1,8 s, en boucle.
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      const state = useAppStore.getState();
      const idx = PIVOT_YEARS.indexOf(state.year);
      const next = PIVOT_YEARS[(idx + 1) % PIVOT_YEARS.length] ?? 2025;
      state.setYear(next);
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-3xl rounded-[28px] border border-white/[0.07] bg-black/35 shadow-[0_16px_40px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
        {/* Rangée haute : mode · statut · scénarios */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pt-3.5">
          <div className="flex rounded-full bg-white/5 p-0.5" role="tablist" aria-label="Mode d’affichage">
            {(
              [
                { value: 'STORY', label: 'Récit', Icon: BookOpen },
                { value: 'EXPLORE', label: 'Exploration', Icon: Compass },
              ] as const
            ).map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors',
                  mode === value ? 'bg-white/15 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3 w-3" aria-hidden strokeWidth={1.75} />
                {label}
              </button>
            ))}
          </div>

          <div
            className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-500"
            aria-live="polite"
            title="Dernière requête DuckDB-WASM"
          >
            <span
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full',
                metricsStatus === 'error' && 'bg-red-400/80',
                metricsStatus === 'loading' && 'animate-pulse bg-amber-200/80',
                metricsStatus === 'ready' && 'bg-emerald-300/70',
                metricsStatus === 'idle' && 'bg-zinc-600',
              )}
            />
            {metricsStatus === 'ready' && lastQueryMs !== null
              ? `DuckDB · ${lastQueryMs.toFixed(0)} ms`
              : metricsStatus === 'loading'
                ? 'DuckDB…'
                : metricsStatus === 'error'
                  ? 'DuckDB en erreur'
                  : 'DuckDB'}
          </div>

          <div className="ml-auto flex rounded-full bg-white/5 p-0.5" role="group" aria-label="Scénario climatique">
            {SCENARIOS.map((s: Scenario) => (
              <button
                key={s}
                type="button"
                aria-pressed={scenario === s}
                onClick={() => setScenario(s)}
                className={cn(
                  'rounded-full px-2.5 py-1 font-mono text-[10px] font-medium transition-colors',
                  scenario === s ? 'bg-white/15 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200',
                )}
              >
                {SCENARIO_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Rangée centrale : lecture + timeline */}
        <div className="flex items-center gap-3 px-5 pt-2">
          <button
            type="button"
            onClick={togglePlaying}
            aria-label={isPlaying ? 'Pause' : 'Lecture'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-zinc-100 transition-colors hover:bg-white/20"
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
            ) : (
              <Play className="ml-0.5 h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <input
              type="range"
              min={0}
              max={PIVOT_YEARS.length - 1}
              step={1}
              value={yearIndex}
              aria-label="Horizon temporel"
              onChange={(e) => {
                const next = PIVOT_YEARS[Number(e.target.value)];
                if (next !== undefined) setYear(next);
              }}
              className="territoires-range w-full"
            />
            <div className="flex justify-between font-mono text-[10px] text-zinc-500">
              {PIVOT_YEARS.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setYear(y)}
                  className={cn(
                    'px-1 transition-colors',
                    y === year ? 'font-semibold text-zinc-100' : 'hover:text-zinc-300',
                  )}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>
          <div className="w-14 shrink-0 text-right font-mono text-xl font-light tabular-nums text-zinc-50">
            {year}
          </div>
        </div>

        {/* Rangée basse : aléas */}
        <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3.5 pt-1" role="group" aria-label="Aléa climatique">
          {INDICATORS.map((ind: Indicator) => {
            const Icon = INDICATOR_ICONS[ind];
            const active = indicator === ind;
            return (
              <button
                key={ind}
                type="button"
                aria-pressed={active}
                onClick={() => setIndicator(ind)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors',
                  active ? 'bg-white/15 text-white shadow-sm' : 'bg-white/5 text-zinc-400 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
                {INDICATOR_LABELS[ind]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
