import { useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import HybridMap3D from './components/map/HybridMap3D';
import ExecutiveBriefModal from './components/ui/ExecutiveBriefModal';
import TimelineDock from './components/ui/TimelineDock';
import { cn } from './lib/utils';
import { STORY_STEPS, useAppStore } from './store/useAppStore';

const GLASS =
  'border border-white/[0.07] bg-black/35 shadow-[0_16px_40px_rgba(0,0,0,0.6)] backdrop-blur-2xl';
const MICRO_LABEL = 'text-[10px] font-medium uppercase tracking-widest text-zinc-500';

export default function App() {
  const mode = useAppStore((s) => s.mode);
  const metricsStatus = useAppStore((s) => s.metricsStatus);
  const metricsError = useAppStore((s) => s.metricsError);
  const metricsData = useAppStore((s) => s.metricsData);
  const storyStep = useAppStore((s) => s.storyStep);
  const setStoryStep = useAppStore((s) => s.setStoryStep);
  const nextStoryStep = useAppStore((s) => s.nextStoryStep);
  const prevStoryStep = useAppStore((s) => s.prevStoryStep);
  const refreshMetrics = useAppStore((s) => s.refreshMetrics);

  // Chargement initial DuckDB-WASM.
  useEffect(() => {
    void refreshMetrics();
  }, [refreshMetrics]);

  const meanRisk = useMemo(() => {
    if (metricsData.size === 0) return null;
    let sum = 0;
    for (const point of metricsData.values()) sum += point.composite;
    return sum / metricsData.size;
  }, [metricsData]);

  const activeStep = STORY_STEPS[storyStep];

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#070b12] font-sans text-zinc-100">
      {/* z-0 : carte 3D plein écran */}
      <HybridMap3D />

      {/* z-10 : calque UI flottante */}
      <div className="pointer-events-none fixed inset-0 z-10">
        {/* Top-Left : titre & état */}
        <header className={cn('pointer-events-auto absolute left-4 top-4 rounded-full py-2 pl-4 pr-3', GLASS)}>
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-[13px] font-semibold leading-none tracking-wide text-zinc-50">
                TERRITOIRES 2100
              </h1>
              <p className="mt-1 text-[10px] leading-none text-zinc-500">
                République Française · Transition Écologique
              </p>
            </div>
            <span className="h-6 w-px bg-white/10" aria-hidden />
            <div className="flex items-center gap-1.5" aria-live="polite">
              <span
                className={cn(
                  'inline-block h-1.5 w-1.5 rounded-full',
                  metricsStatus === 'error' && 'bg-red-400/80',
                  metricsStatus === 'loading' && 'animate-pulse bg-amber-200/80',
                  metricsStatus === 'ready' && 'bg-emerald-300/70 shadow-[0_0_8px_rgba(110,231,183,0.5)]',
                  metricsStatus === 'idle' && 'bg-zinc-600',
                )}
              />
              <span className="font-mono text-[10px] text-zinc-400">
                {metricsStatus === 'ready'
                  ? 'DuckDB-WASM connecté'
                  : metricsStatus === 'loading'
                    ? 'DuckDB-WASM…'
                    : metricsStatus === 'error'
                      ? 'DuckDB-WASM en erreur'
                      : 'DuckDB-WASM'}
              </span>
            </div>
          </div>
        </header>

        {/* Top-Center : carte du chapitre (mode Récit) */}
        {mode === 'STORY' && activeStep && (
          <section
            aria-label="Chapitre du récit"
            className={cn(
              'pointer-events-auto absolute left-1/2 top-4 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-3xl px-5 py-4',
              GLASS,
            )}
          >
            <p className={MICRO_LABEL}>
              Chapitre {storyStep + 1} / {STORY_STEPS.length} — {activeStep.camera.center[1].toFixed(2)}°N,{' '}
              {activeStep.camera.center[0].toFixed(2)}°E
            </p>
            <h2 className="mt-1.5 text-base font-medium leading-snug text-zinc-50">{activeStep.title}</h2>
            <p className="mt-1 line-clamp-2 text-[13px] font-light leading-relaxed text-zinc-400">
              {activeStep.description}
            </p>
            <div className="mt-3 flex items-center gap-1.5">
              <button
                type="button"
                onClick={prevStoryStep}
                aria-label="Chapitre précédent"
                className="rounded-full bg-white/5 p-1.5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden strokeWidth={1.75} />
              </button>
              {STORY_STEPS.map((step, i) => (
                <button
                  key={step.title}
                  type="button"
                  onClick={() => setStoryStep(i)}
                  aria-label={`Chapitre ${i + 1} : ${step.title}`}
                  aria-current={i === storyStep}
                  className={cn(
                    'h-1.5 rounded-full transition-all motion-reduce:transition-none',
                    i === storyStep ? 'w-8 bg-zinc-100' : 'w-3 bg-white/20 hover:bg-white/35',
                  )}
                />
              ))}
              <button
                type="button"
                onClick={nextStoryStep}
                aria-label="Chapitre suivant"
                className="rounded-full bg-white/5 p-1.5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ChevronRight className="h-4 w-4" aria-hidden strokeWidth={1.75} />
              </button>
            </div>
          </section>
        )}

        {/* Bottom-Left : légende du gradient de risque */}
        <div className={cn('absolute bottom-6 left-4 hidden rounded-3xl px-4 py-3 sm:block', GLASS)}>
          <p className={MICRO_LABEL}>Risque composite</p>
          <div
            className="mt-2 h-1.5 w-44 rounded-full"
            style={{
              background: 'linear-gradient(to right, #1e293b, #3f4c63 35%, #b45309 55%, #9a3412 75%, #991b1b)',
            }}
            aria-hidden
          />
          <div className="mt-1.5 flex justify-between font-mono text-[10px] text-zinc-500">
            <span>0 · faible</span>
            <span>1 · critique</span>
          </div>
          <p className="mt-2 font-mono text-[10px] text-zinc-500" aria-live="polite">
            {metricsData.size > 0
              ? `${metricsData.size.toLocaleString('fr-FR')} communes · moyenne ${meanRisk?.toFixed(2) ?? '—'}`
              : 'Chargement des métriques…'}
          </p>
        </div>

        {/* Erreur métriques */}
        {metricsStatus === 'error' && metricsError && (
          <div
            role="alert"
            className={cn(
              'pointer-events-auto absolute bottom-40 left-4 flex max-w-sm items-start gap-2 rounded-3xl px-4 py-3 sm:bottom-48',
              GLASS,
            )}
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden strokeWidth={1.75} />
            <p className="text-xs leading-relaxed text-zinc-300">
              Requête DuckDB-WASM en échec : {metricsError}. Vérifiez les symlinks{' '}
              <span className="font-mono">public/data</span> puis rechargez la page.
            </p>
          </div>
        )}
      </div>

      {/* Right-Sheet décisionnelle + Dock temporel */}
      <ExecutiveBriefModal />
      <TimelineDock />
    </div>
  );
}
