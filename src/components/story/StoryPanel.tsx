import { useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown } from 'lucide-react';
import {
  PIVOT_YEARS,
  SCENARIOS,
  SCENARIO_LABELS,
  type Scenario,
} from '../../lib/metricsTypes';
import { cn } from '../../lib/utils';
import { STORY_STEPS } from './steps';
import { useAppStore } from '../../store/useAppStore';

/**
 * Panneau narratif éditorial (mode Récit), Liquid Glass clair :
 * un vrai récit climatique en cinq chapitres territoriaux.
 * La caméra et les données de la carte suivent le chapitre actif.
 */
const SEGMENT_LABELS: Record<Scenario, string> = {
  ssp126: '+1.5°C',
  ssp245: '+2.7°C',
  ssp585: '+4.0°C',
};

export default function StoryPanel() {
  const mode = useAppStore((s) => s.mode);
  const storyStep = useAppStore((s) => s.storyStep);
  const setStoryStep = useAppStore((s) => s.setStoryStep);
  const nextStoryStep = useAppStore((s) => s.nextStoryStep);
  const prevStoryStep = useAppStore((s) => s.prevStoryStep);
  const scenario = useAppStore((s) => s.scenario);
  const year = useAppStore((s) => s.year);
  const setScenario = useAppStore((s) => s.setScenario);
  const setYear = useAppStore((s) => s.setYear);
  const [timeOpen, setTimeOpen] = useState(true);

  const yearIndex = Math.max(0, PIVOT_YEARS.indexOf(year));
  const fillPercent = (yearIndex / (PIVOT_YEARS.length - 1)) * 100;

  if (mode !== 'STORY') return null;
  const step = STORY_STEPS[storyStep];
  if (!step) return null;
  const isFirst = storyStep === 0;
  const isLast = storyStep === STORY_STEPS.length - 1;

  return (
    <section
      aria-label={`Story — ${step.chapter}: ${step.title}`}
      className="glass-strong pointer-events-auto absolute left-4 top-24 flex max-h-[calc(100vh-15rem)] w-96 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-3xl p-6 text-slate-900 sm:left-[4.75rem] max-sm:bottom-20 max-sm:left-3 max-sm:right-3 max-sm:top-auto max-sm:max-h-[44vh] max-sm:w-auto"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
        {step.chapter} · {step.dataNature === 'observed' ? `Observed data · ${step.periodLabel ?? '1982-2025'}` : `${SCENARIO_LABELS[step.scenario]} · ${step.year}`}
      </p>
      <h2 className="mt-2 font-serif text-[24px] font-semibold leading-tight tracking-[-0.01em] text-slate-900">{step.title}</h2>
      <p className="mt-3 text-[15px] leading-relaxed text-slate-700">{step.narrative}</p>

      <div className="mt-5 border-y border-slate-900/10 py-4 text-slate-900">
        <p className="font-serif text-4xl font-semibold tracking-[-0.01em]">{step.bigStat}</p>
        <p className="mt-1 text-sm text-slate-500">{step.bigStatLabel}</p>
        <p className="mt-3 text-xl font-semibold">
          {step.secondStat}{' '}
          <span className="text-sm font-normal text-slate-500">{step.secondStatLabel}</span>
        </p>
      </div>

      <div className="mt-5 flex gap-1.5" aria-hidden>
        {STORY_STEPS.map((s, i) => (
          <span
            key={s.id}
            className={cn('h-1 flex-1 rounded-full', i <= storyStep ? 'bg-amber-500' : 'bg-slate-200')}
          />
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={prevStoryStep}
          disabled={isFirst}
          className="flex items-center gap-1.5 rounded-full border border-slate-300 bg-white/70 px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Previous chapter
        </button>
        <button
          type="button"
          onClick={nextStoryStep}
          disabled={isLast}
          className="flex items-center gap-1.5 rounded-full border border-slate-900 bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next chapter <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {step.dataNature && step.sources && (
        <div className="mt-4 border-t border-slate-200/80 pt-3 text-[11px] leading-relaxed text-slate-500">
          <p>
            <span className="font-semibold text-slate-700">
              {step.dataNature === 'observed' ? 'Observed data. ' : 'Demonstration data. '}
            </span>
            {step.sources}
          </p>
          {step.limitations && <p className="mt-1">{step.limitations}</p>}
        </div>
      )}

      {/* Module temporel du récit : trajectoire + horizon, repliable
          indépendamment du texte du chapitre. */}
      <div className="mt-5 border-t border-slate-200/80 pt-3">
        <button
          type="button"
          onClick={() => setTimeOpen((v) => !v)}
          aria-expanded={timeOpen}
          className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-slate-800"
        >
          <span>Trajectory &amp; horizon</span>
          <ChevronDown className={cn('h-4 w-4 transition-transform', timeOpen && 'rotate-180')} aria-hidden />
        </button>
        {timeOpen && step.dataNature === 'observed' && (
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Observed data: the climate trajectory and horizon do not apply.
            The values shown are identical in 1990, 2025, 2050 and 2100 (plateau, no projection).
          </p>
        )}
        {timeOpen && step.dataNature !== 'observed' && (
          <div className="mt-3">
            <div className="flex items-center gap-0.5 rounded-full bg-slate-900/5 p-1" role="group" aria-label="Climate trajectory">
              {SCENARIOS.map((s: Scenario) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scenario === s}
                  onClick={() => setScenario(s)}
                  className={cn(
                    'flex-1 rounded-full px-2 py-1 text-[11px] whitespace-nowrap transition-colors',
                    scenario === s
                      ? 'bg-white font-semibold text-slate-900 shadow-sm'
                      : 'font-medium text-slate-500 hover:text-slate-800',
                  )}
                >
                  {SEGMENT_LABELS[s]}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <input
                  type="range"
                  min={0}
                  max={PIVOT_YEARS.length - 1}
                  step={1}
                  value={yearIndex}
                  aria-label="Story time horizon"
                  onChange={(e) => {
                    const next = PIVOT_YEARS[Number(e.target.value)];
                    if (next !== undefined) setYear(next);
                  }}
                  className="territoires-range w-full"
                  style={{
                    background: `linear-gradient(to right, #0f172a 0%, #0f172a ${fillPercent}%, #e2e8f0 ${fillPercent}%, #e2e8f0 100%)`,
                  }}
                />
                <div className="mt-1 flex w-full justify-between px-0.5 text-[10px] font-semibold text-slate-500">
                  {PIVOT_YEARS.map((y) => (
                    <button
                      key={y}
                      type="button"
                      onClick={() => setYear(y)}
                      className={cn('px-0.5', y === year ? 'font-bold text-slate-900' : 'hover:text-slate-700')}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              </div>
              <div className="shrink-0 rounded-lg bg-white/50 px-2.5 py-0.5 font-mono text-sm font-bold tabular-nums text-slate-800">
                {year}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex justify-center gap-1" aria-label="Go to a chapter">
        {STORY_STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStoryStep(i)}
            aria-label={`${s.chapter}: ${s.title}`}
            aria-current={i === storyStep}
            className={cn(
              'rounded-full px-2 py-1 font-mono text-[11px] transition-colors',
              i === storyStep ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </section>
  );
}
