import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { buildCommuneMeasure, buildFragilitySummary, isSimulated, type FragilityStatus } from '../../lib/executiveBrief';
import { SCENARIO_LABELS, type Indicator, type Scenario } from '../../lib/metricsTypes';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/useAppStore';

const SPARK_W = 304;
const SPARK_H = 64;
const PAD = 6;

/** Courbe lissée (Catmull-Rom -> Bézier) pour l'area chart. */
function straightPath(pts: { x: number; y: number }[]): string {
  // Segments droits entre horizons : aucune courbure inventée.
  if (pts.length < 2) return '';
  return pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x},${pt.y}`).join(' ');
}

/** Unité du graphique : exactement la métrique du texte principal (aléa brut simulé). */
const CHART_UNITS: Partial<Record<Indicator, string>> = {
  heatwave: 'days of extreme heat per year',
  water_stress: 'days of water shortage per year',
  rga: 'simulated clay shrink-swell index (0 to 10)',
  flooding: 'simulated flood exposure index (simulation scale)',
};

const FRAGILITY_STATUS_META: Record<FragilityStatus, { label: string; dotClass: string; textClass: string }> = {
  flagged: { label: 'Flagged', dotClass: 'bg-amber-500', textClass: 'text-amber-800' },
  'not-flagged': { label: 'Not flagged', dotClass: 'bg-emerald-600', textClass: 'text-emerald-800' },
  'not-assessed': { label: 'Not assessed', dotClass: 'bg-slate-400', textClass: 'text-slate-600' },
};

function formatChartValue(indicator: Indicator, value: number): string {
  return indicator === 'rga' ? value.toFixed(1) : String(Math.round(value));
}

function AreaChart({
  rows,
  scenario,
  indicator,
}: {
  rows: { year: number; value: number }[];
  scenario: Scenario;
  indicator: Indicator;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const validRows = useMemo(() => rows.filter((r) => r.value >= 0), [rows]);
  const unit = CHART_UNITS[indicator] ?? '';
  const geometry = useMemo(() => {
    if (validRows.length === 0) return null;
    const rows = validRows;
    const years = rows.map((r) => r.year);
    const minY = Math.min(...years);
    const maxY = Math.max(...years);
    const maxV = Math.max(0.05, ...rows.map((r) => r.value));
    const pts = rows.map((r) => ({
      year: r.year,
      value: r.value,
      x: PAD + ((r.year - minY) / Math.max(1, maxY - minY)) * (SPARK_W - PAD * 2),
      y: SPARK_H - PAD - (r.value / maxV) * (SPARK_H - PAD * 2),
    }));
    const line = straightPath(pts);
    const area = `${line} L ${pts[pts.length - 1]?.x},${SPARK_H - 2} L ${pts[0]?.x},${SPARK_H - 2} Z`;
    return { pts, line, area };
  }, [validRows]);

  if (!geometry) {
    return <p className="text-xs text-slate-500">History not available for this municipality.</p>;
  }
  // Valeurs identiques aux horizons : une courbe plate serait trompeuse.
  if (validRows.length > 1 && Math.max(...validRows.map((r) => r.value)) - Math.min(...validRows.map((r) => r.value)) < 1e-9) {
    return (
      <p className="text-xs leading-relaxed text-slate-500">
        Simulated value identical across the displayed horizons ({formatChartValue(indicator, validRows[0]?.value ?? 0)} {unit}): no change to plot.
      </p>
    );
  }
  const hoveredPoint = hovered !== null ? geometry.pts[hovered] : null;
  return (
    <figure>
      <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H + 14}`} className="w-full" role="img"
        aria-label={`Simulated change, in ${unit}, between ${validRows[0]?.year} and ${validRows[validRows.length - 1]?.year}, ${SCENARIO_LABELS[scenario]}`}>
        <path d={geometry.area} fill="#0f172a" fillOpacity="0.07" />
        <path d={geometry.line} fill="none" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" />
        {geometry.pts.map((pt, i) => (
          <g key={pt.year}>
            <circle
              cx={pt.x}
              cy={pt.y}
              r={hovered === i ? 5 : 3.5}
              fill="#ffffff"
              stroke="#0f172a"
              strokeWidth="2"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer', transition: 'r 120ms ease' }}
            >
              <title>{`${pt.year} — ${formatChartValue(indicator, pt.value)} ${unit}`}</title>
            </circle>
            <text x={Math.min(Math.max(pt.x, 16), SPARK_W - 16)} y={SPARK_H + 11} textAnchor="middle" fontSize="8.5" fill="#94a3b8" fontWeight={600}>
              {pt.year}
            </text>
          </g>
        ))}
        {hoveredPoint && (
          <text
            x={Math.min(Math.max(hoveredPoint.x, 34), SPARK_W - 34)}
            y={Math.max(hoveredPoint.y - 10, 10)}
            textAnchor="middle"
            fontSize="9"
            fontWeight={700}
            fill="#0f172a"
          >
            {hoveredPoint.year} · {formatChartValue(indicator, hoveredPoint.value)} {unit}
          </text>
        )}
      </svg>
      <figcaption className="mt-0.5 text-center text-[11px] text-slate-500">
        In {unit} — {SCENARIO_LABELS[scenario]}. Hover over the points for the value at each horizon.
      </figcaption>
    </figure>
  );
}

/**
 * Fiche communale : mesure de la couche active, données observées, sources.
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
        .map((r) => ({ year: r.year, value: r.hazardLocal })),
    [history, scenario, indicator],
  );

  const measure = useMemo(
    () => buildCommuneMeasure(indicator, profile, history ?? [], scenario),
    [indicator, profile, history, scenario],
  );

  const fragilitySummary = useMemo(
    () => (indicator === 'fragilites' ? buildFragilitySummary(history ?? []) : null),
    [indicator, history],
  );

  const fragilityPriceContext = useMemo(() => {
    if (indicator !== 'fragilites') return null;
    const prix = (history ?? []).find(
      (r) => r.scenario === 'ssp245' && r.indicator === 'prix_immo' && r.year === 2025,
    );
    if (!prix) return null;
    return prix.composite < 0
      ? 'Not available (fewer than 30 observed sales)'
      : `${Math.round(prix.hazardLocal).toLocaleString('en-US')} €/m² median (2023-2025)`;
  }, [indicator, history]);

  const profilTerritorial = useMemo(() => {
    const ligne = (ind: Indicator) =>
      (history ?? []).find((r) => r.scenario === 'ssp245' && r.indicator === ind && r.year === 2025);
    const catnat = ligne('catnat');
    if (!catnat) return [];
    const services = ligne('services');
    const voiture = ligne('voiture_travail');
    const tc = ligne('transports_communs');
    const prix = ligne('prix_immo');
    const cumul = ligne('fragilites');
    const lignes: { label: string; texte: string }[] = [
      { label: 'CatNat history', texte: `${Math.round(catnat.hazardLocal)} declarations since 1982` },
    ];
    if (services) {
      lignes.push({
        label: 'Local services',
        texte: `${Math.round(services.composite * 7)}/7 categories · ${Math.round(services.hazardLocal)} facilities`,
      });
    }
    if (voiture) {
      lignes.push({
        label: 'Commuting by car',
        texte: voiture.composite < 0 ? 'Not available for this municipality (fewer than 30 employed workers observed)' : `${Math.round(voiture.hazardLocal)}% of employed workers`,
      });
    }
    if (tc) {
      lignes.push({
        label: 'Public transport',
        texte: tc.composite < 0 ? 'Not available for this municipality (fewer than 30 employed workers observed)' : `${Math.round(tc.hazardLocal)}% of employed workers`,
      });
    }
    if (prix) {
      lignes.push({
        label: 'Property prices (context)',
        texte: prix.composite < 0 ? 'Not available (fewer than 30 observed sales)' : `${Math.round(prix.hazardLocal).toLocaleString('en-US')} €/m² median`,
      });
    }
    if (cumul) {
      lignes.push({
        label: 'Observed cumulative count',
        texte: cumul.composite < 0 ? 'Not calculated (missing data)' : `${Math.round(cumul.hazardLocal)} of 3 dimensions`,
      });
    }
    return lignes;
  }, [history]);

  return (
    <aside
      aria-hidden={!open}
      aria-label="Municipality decision brief"
      className={cn(
        'pointer-events-auto fixed bottom-24 right-6 top-20 z-40 flex w-[min(24rem,calc(100vw-3rem))] flex-col overflow-hidden',
        'glass-strong rounded-3xl text-slate-900',
        'transition-all duration-500 ease-out motion-reduce:transition-none',
        open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-[110%] opacity-0',
      )}
    >
      {open && (
        <>
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Municipality</p>
              <h2 className="mt-1 truncate font-serif text-xl font-semibold leading-snug tracking-[-0.01em] text-slate-900">
                {selectedCommuneName ?? profile?.nom ?? selectedCommune}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => selectCommune(null)}
              aria-label="Close the brief"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-md transition-transform hover:scale-105"
            >
              <X className="h-5 w-5" aria-hidden strokeWidth={2.25} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pr-2">
          <div className="mt-4 border-y border-slate-200 py-3.5">
            <p className="text-xs font-semibold text-slate-500">{measure.title}</p>
            <p className="mt-1 font-serif text-xl font-semibold leading-snug text-slate-900">
              {measure.headline}
            </p>
            <p className="mt-1 text-xs text-slate-500">{measure.period}</p>
            <p className="mt-2.5 text-sm leading-relaxed text-slate-700">{measure.reading}</p>
            {historyStatus === 'loading' && (
              <p className="mt-2 text-sm text-slate-500">Loading municipality data…</p>
            )}
            {historyStatus === 'error' && historyError && (
              <p role="alert" className="mt-2 text-sm text-red-600">Failed to load: {historyError}</p>
            )}
          </div>

          {/* Évolution uniquement pour la simulation : un plateau observé n'est pas une trajectoire. */}
          {isSimulated(indicator) && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-slate-700">Change over time (simulation)</h3>
              <div className="mt-1.5">
                <AreaChart rows={currentRows} scenario={scenario} indicator={indicator} />
              </div>
            </div>
          )}

          {fragilitySummary && (
            <section className="mt-5" aria-label="Territorial fragility summary">
              <h3 className="text-sm font-semibold text-slate-900">Territorial fragility summary</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
                This result counts, with equal weight, how many of the three observed dimensions
                below cross a documented reading threshold. It is not a risk score, a probability
                or a prediction, and no simulated climate layer enters the count.
              </p>
              <ul>
                {fragilitySummary.dimensions.map((dim) => {
                  const meta = FRAGILITY_STATUS_META[dim.status];
                  return (
                    <li key={dim.key} className="border-t border-slate-900/10 py-3.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <h4 className="text-sm font-semibold text-slate-900">{dim.name}</h4>
                        <span className={cn('flex shrink-0 items-center gap-1.5 text-xs font-semibold', meta.textClass)}>
                          <span className={cn('h-2 w-2 rounded-full', meta.dotClass)} aria-hidden />
                          {meta.label}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-slate-900">{dim.observedText}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{dim.dataLabel}</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">
                        <span className="font-semibold text-slate-700">Rule: </span>
                        {dim.ruleText}. {dim.explanation}
                      </p>
                    </li>
                  );
                })}
              </ul>
              {fragilityPriceContext && (
                <p className="border-t border-slate-900/10 pt-3 text-xs leading-relaxed text-slate-600">
                  <span className="font-semibold text-slate-700">Property prices (context, not counted): </span>
                  {fragilityPriceContext}. A high or low price is not in itself a fragility.
                </p>
              )}
            </section>
          )}

          {indicator !== 'fragilites' && profilTerritorial.length > 0 && (
            <section className="mt-5" aria-label="Territorial profile, observed data">
              <h3 className="text-xs font-semibold text-slate-700">Observed data</h3>
              <ul className="mt-2 flex flex-col gap-1.5">
                {profilTerritorial.map((ligne) => (
                  <li key={ligne.label} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="shrink-0 font-medium text-slate-500">{ligne.label}</span>
                    <span className="text-right font-medium text-slate-800">{ligne.texte}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                The property price is provided for context: it is not included in the fragility count.
              </p>
            </section>
          )}

          <details className="mt-5">
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">
              Sources and method
            </summary>
            <h4 className="mt-3 text-xs font-semibold text-slate-700">What this indicator measures</h4>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{measure.explanation}</p>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">{measure.period}.</p>
            {profile && (
              <p className="mt-2 font-mono text-[11px] leading-relaxed text-slate-500">
                INSEE code {selectedCommune} · Department {profile.dept} · {profile.lat.toFixed(2)}°, {profile.lon.toFixed(2)}°
              </p>
            )}
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              No local recommendation is automatically derived from these data: they describe the municipality at municipal level and do not locate the buildings or residents concerned.
            </p>
          </details>
          </div>
        </>
      )}
    </aside>
  );
}
