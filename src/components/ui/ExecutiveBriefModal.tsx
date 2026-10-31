import { useMemo } from 'react';
import { Sparkles, X } from 'lucide-react';
import { buildExecutiveBrief } from '../../lib/executiveBrief';
import { INDICATOR_LABELS, SCENARIO_LABELS, type Indicator, type Scenario } from '../../lib/metricsTypes';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/useAppStore';

const SPARK_W = 304;
const SPARK_H = 64;
const PAD = 6;

function Sparkline({
  rows,
  scenario,
  indicator,
}: {
  rows: { year: number; composite: number }[];
  scenario: Scenario;
  indicator: Indicator;
}) {
  const points = useMemo(() => {
    if (rows.length === 0) return '';
    const years = rows.map((r) => r.year);
    const minY = Math.min(...years);
    const maxY = Math.max(...years);
    const maxV = Math.max(0.05, ...rows.map((r) => r.composite));
    return rows
      .map((r) => {
        const x = PAD + ((r.year - minY) / Math.max(1, maxY - minY)) * (SPARK_W - PAD * 2);
        const y = SPARK_H - PAD - (r.composite / maxV) * (SPARK_H - PAD * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [rows]);

  if (rows.length === 0) {
    return <p className="text-xs text-zinc-500">Historique indisponible pour cette commune.</p>;
  }
  const last = rows[rows.length - 1];
  return (
    <figure>
      <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} className="w-full" role="img"
        aria-label={`Risque ${INDICATOR_LABELS[indicator]} ${SCENARIO_LABELS[scenario]} : ${rows.map((r) => `${r.year} ${r.composite.toFixed(2)}`).join(', ')}`}>
        <polyline points={points} fill="none" stroke="#f4f4f5" strokeWidth="1.5" strokeLinejoin="round" />
        {rows.map((r, i) => {
          const coords = points.split(' ')[i]?.split(',') ?? ['0', '0'];
          return <circle key={r.year} cx={coords[0]} cy={coords[1]} r="2.5" fill="#f4f4f5" />;
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between font-mono text-[10px] text-zinc-500">
        <span>{rows[0]?.year}</span>
        <span>
          {SCENARIO_LABELS[scenario]} · {last?.year} : {last?.composite.toFixed(2)}
        </span>
        <span>{rows[rows.length - 1]?.year}</span>
      </figcaption>
    </figure>
  );
}

function riskTone(score: number | null): string {
  if (score === null) return 'text-zinc-400';
  if (score >= 0.66) return 'text-red-300';
  if (score >= 0.45) return 'text-amber-200';
  return 'text-zinc-100';
}

/**
 * Volet décisionnel IA (synthèse déterministe PNACC-3, données DuckDB-WASM).
 * Glisse depuis la droite lorsqu'une commune est sélectionnée sur la carte.
 */
export default function ExecutiveBriefModal() {
  const selectedCommune = useAppStore((s) => s.selectedCommune);
  const selectedCommuneName = useAppStore((s) => s.selectedCommuneName);
  const profile = useAppStore((s) => s.communeProfile);
  const history = useAppStore((s) => s.communeHistory);
  const historyStatus = useAppStore((s) => s.historyStatus);
  const historyError = useAppStore((s) => s.historyError);
  const scenario = useAppStore((s) => s.scenario);
  const indicator = useAppStore((s) => s.indicator);
  const selectCommune = useAppStore((s) => s.selectCommune);

  const open = selectedCommune !== null;

  const currentRows = useMemo(
    () =>
      (history ?? [])
        .filter((r) => r.scenario === scenario && r.indicator === indicator)
        .sort((a, b) => a.year - b.year)
        .map((r) => ({ year: r.year, composite: r.composite })),
    [history, scenario, indicator],
  );

  const brief = useMemo(
    () => buildExecutiveBrief(profile, history ?? [], scenario, indicator),
    [profile, history, scenario, indicator],
  );

  return (
    <aside
      aria-hidden={!open}
      aria-label="Fiche décisionnelle de la commune"
      className={cn(
        'pointer-events-auto fixed right-4 top-1/2 z-30 w-[min(24rem,calc(100vw-2rem))] -translate-y-1/2',
        'border border-white/[0.07] bg-zinc-950/70 shadow-[0_16px_40px_rgba(0,0,0,0.6)] backdrop-blur-2xl',
        'transition-all duration-500 ease-out motion-reduce:transition-none',
        open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-[110%] opacity-0',
      )}
    >
      {open && (
        <div className="max-h-[calc(100vh-3rem)] overflow-y-auto p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                Fiche décisionnelle
              </p>
              <h2 className="mt-1 truncate text-lg font-medium leading-snug text-zinc-50">
                {selectedCommuneName ?? profile?.nom ?? selectedCommune}
              </h2>
              <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                INSEE {selectedCommune}
                {profile ? ` · Dép. ${profile.dept} · ${profile.lat.toFixed(2)}°, ${profile.lon.toFixed(2)}°` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => selectCommune(null)}
              aria-label="Fermer la fiche"
              className="shrink-0 rounded-full bg-white/5 p-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
            >
              <X className="h-4 w-4" aria-hidden strokeWidth={1.75} />
            </button>
          </div>

          <div className="mt-4 flex items-end justify-between border-y border-white/[0.07] py-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                Risque 2050 · {INDICATOR_LABELS[indicator]}
              </p>
              <p className={cn('mt-0.5 font-mono text-3xl font-light tabular-nums', riskTone(brief.risk2050))}>
                {brief.risk2050 !== null ? brief.risk2050.toFixed(2) : '—'}
              </p>
            </div>
            <p className="text-right font-mono text-[11px] leading-relaxed text-zinc-500">
              1990 : {brief.risk1990?.toFixed(2) ?? '—'}
              <br />
              2100 : {brief.risk2100?.toFixed(2) ?? '—'}
            </p>
          </div>

          <div className="mt-4">
            <Sparkline rows={currentRows} scenario={scenario} indicator={indicator} />
          </div>

          <section className="mt-5" aria-label="Synthèse exécutive">
            <h3 className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
              <Sparkles className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
              Synthèse exécutive pour le maire
            </h3>
            {historyStatus === 'loading' && (
              <p className="mt-2 text-sm text-zinc-400">Analyse DuckDB-WASM de l’historique communal…</p>
            )}
            {historyStatus === 'error' && historyError && (
              <p role="alert" className="mt-2 text-sm text-red-300">Échec de l’analyse : {historyError}</p>
            )}
            {historyStatus === 'ready' && (
              <>
                <p className="mt-2 text-sm leading-relaxed text-zinc-300">{brief.diagnostic}</p>
                <h4 className="mt-4 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                  Préconisations PNACC-3
                </h4>
                <ol className="mt-2 space-y-2.5">
                  {brief.recommendations.map((reco, i) => (
                    <li key={reco} className="flex gap-2.5 text-sm leading-relaxed text-zinc-300">
                      <span className="mt-0.5 shrink-0 font-mono text-[11px] text-zinc-500">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span>{reco}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-4 font-mono text-[10px] leading-relaxed text-zinc-600">
                  Synthèse déterministe générée localement depuis les historiques DuckDB-WASM
                  (3 scénarios × 4 aléas × 4 horizons) — aucun envoi externe.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}
