import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  INDICATORS,
  INDICATOR_LABELS,
  SCENARIOS,
  SCENARIO_SHORT_LABELS,
  type Indicator,
  type Scenario,
} from '../../lib/metricsTypes';
import { ALEA_PALETTES, INDICATOR_SOURCES, MISSING_COLOR } from '../../lib/palettes';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/useAppStore';

interface LegendData {
  title: string;
  labels: readonly string[];
}

/** Indicateurs observés : l'en-tête affiche la période, jamais un horizon projeté. */
const OBSERVED_PERIODS: Partial<Record<Indicator, string>> = {
  catnat: 'Observed 1982-2025',
  prix_immo: 'Observed 2023-2025',
  cher_expose: 'Observed 2023-2025 × 1982-2025',
  services: 'Observed as of January 1, 2025',
  voiture_menages: 'Observed in 2023',
  voiture_travail: 'Observed in 2023',
  transports_communs: 'Observed in 2023',
  fragilites: 'Observed 2023-2025 (summary)',
};

const LEGEND_DATA: Record<Indicator, LegendData> = {
  heatwave: {
    title: 'Days of extreme heat per year',
    labels: ['5 days', '13 days', '20 days', '28 days', '35 days', '43 days', '50 days'],
  },
  rga: {
    title: 'Exposure to clay shrink-swell',
    labels: ['Low', 'Moderate', 'Medium', 'High', 'Very high', 'Critical', 'Clay emergency'],
  },
  flooding: {
    title: 'Exposure to flooding',
    labels: ['Low', 'Moderate', 'Medium', 'High', 'Very high', 'Critical', 'Flood emergency'],
  },
  water_stress: {
    title: 'Days of water shortage per year',
    labels: ['10 days', '25 days', '40 days', '55 days', '70 days', '85 days', '100 days'],
  },
  catnat: {
    title: 'CatNat declarations recorded since 1982 (observed)',
    labels: ['None', '1 to 4', '5 to 8', '9 to 12', '13 to 17', '18 to 24', '25 or more'],
  },
  prix_immo: {
    title: 'Median price per m² for sales in 2023-2025 (DVF, observed)',
    labels: ['Less than €1,400', '€1,400 to €1,750', '€1,750 to €2,050', '€2,050 to €2,450', '€2,450 to €3,100', '€3,100 to €4,500', 'More than €4,500'],
  },
  cher_expose: {
    title: 'Property prices compared with CatNat history (exploratory analysis)',
    labels: ['No overlap', 'Low', 'Moderate', 'Clear', 'Strong', 'Very strong', 'Most pronounced'],
  },
  services: {
    title: 'Essential service families present in the municipality (BPE 2025)',
    labels: ['No families', '1 family', '2 families', '3 families', '4 families', '5 families', '6 to 7 families'],
  },
  voiture_menages: {
    title: 'Households with at least one car (RP 2023, observed)',
    labels: ['Less than 70%', '70% to 85%', '85% to 90%', '90% to 93%', '93% to 96%', '96% to 98%', 'More than 98%'],
  },
  voiture_travail: {
    title: 'Employed people commuting by car (RP 2023, observed)',
    labels: ['Less than 55%', '55% to 70%', '70% to 79%', '79% to 85%', '85% to 89%', '89% to 93%', 'More than 93%'],
  },
  transports_communs: {
    title: 'Employed people commuting by public transport (RP 2023, observed)',
    labels: ['0%', '0% to 2%', '2% to 4%', '4% to 7%', '7% to 12%', '12% to 25%', 'More than 25%'],
  },
  fragilites: {
    title: 'Dimensions flagged out of 3 observed (simple equal-weight count, not a risk score)',
    labels: ['0 dimensions', '0 to 1 dimension', '1 dimension', '1 to 2 dimensions', '2 dimensions', '2 to 3 dimensions', '3 dimensions'],
  },
};

/**
 * Carte de légende quantifiée (modèle MAB) de la couche principale :
 * 7 paliers discrets aux couleurs exactes de la carte, source officielle
 * en accordéon et slider d'opacité. Les réglages année/trajectoire de
 * cette couche restent dans la frise du bas — jamais dupliqués ici.
 */
export default function Legend() {
  const mode = useAppStore((s) => s.mode);
  const scenario = useAppStore((s) => s.scenario);
  const setScenario = useAppStore((s) => s.setScenario);
  const setIndicator = useAppStore((s) => s.setIndicator);
  const indicator = useAppStore((s) => s.indicator);
  const year = useAppStore((s) => s.year);
  const opacity = useAppStore((s) => s.recitLayerOpacity);
  const setOpacity = useAppStore((s) => s.setRecitLayerOpacity);
  const recitOnTop = useAppStore((s) => s.recitOnTop);
  const setRecitOnTop = useAppStore((s) => s.setRecitOnTop);
  const [showSource, setShowSource] = useState(false);

  const data = LEGEND_DATA[indicator];
  const colors = ALEA_PALETTES[indicator];

  return (
    <article
      className="glass-panel panneau-entree flex w-full flex-col gap-3 rounded-2xl p-3.5"
      aria-label={`Legend — ${data.title}`}
    >
      {/* Réglages de la couche principale : Exploration uniquement.
          En Récit, ces réglages vivent au pied du panneau de chapitre. */}
      {mode === 'EXPLORE' && (
        <div className="flex flex-col gap-2 border-b border-slate-200/80 pb-3">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Main layer hazard">
            {INDICATORS.map((ind: Indicator) => (
              <button
                key={ind}
                type="button"
                aria-pressed={indicator === ind}
                onClick={() => setIndicator(ind)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                  indicator === ind
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-white/45 text-slate-600 hover:bg-white/70 hover:text-slate-900',
                )}
              >
                {INDICATOR_LABELS[ind]}
              </button>
            ))}
          </div>
          {!OBSERVED_PERIODS[indicator] && (
          <div className="flex items-center gap-0.5 rounded-full bg-slate-900/5 p-1" role="group" aria-label="Main layer pathway">
            {SCENARIOS.map((s: Scenario) => (
              <button
                key={s}
                type="button"
                aria-pressed={scenario === s}
                title={SCENARIO_SHORT_LABELS[s]}
                onClick={() => setScenario(s)}
                className={cn(
                  'flex-1 rounded-full px-1.5 py-1 text-[11px] whitespace-nowrap transition-colors',
                  scenario === s
                    ? 'bg-white font-semibold text-slate-900 shadow-sm'
                    : 'font-medium text-slate-500 hover:text-slate-800',
                )}
              >
                {s === 'ssp126' ? '+1.5°C' : s === 'ssp245' ? '+2.7°C' : '+4.0°C'}
              </button>
            ))}
          </div>
          )}
        </div>
      )}

      <div>
        <p className="text-xs leading-tight font-semibold text-slate-800">
          {INDICATOR_LABELS[indicator]} · {OBSERVED_PERIODS[indicator] ?? year}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">{data.title}</p>
      </div>

      {/* Paliers quantifiés nets, couleurs identiques à la carte */}
      <div className="flex flex-col gap-1.5">
        {(indicator === 'prix_immo' || indicator === 'cher_expose' || indicator === 'voiture_menages' || indicator === 'voiture_travail' || indicator === 'transports_communs' || indicator === 'fragilites') && (
          <div className="flex items-center gap-2.5">
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-sm border border-black/10"
              style={{ backgroundColor: MISSING_COLOR }}
              aria-hidden
            />
            <span className="text-[11px] font-medium text-slate-600">
              {indicator === 'prix_immo' || indicator === 'cher_expose'
                ? 'Not available (fewer than 30 observed sales)'
                : indicator === 'fragilites'
                ? 'Not calculated (missing data)'
                : 'Not available (fewer than 30 observed households or workers)'}
            </span>
          </div>
        )}
        {colors.map((color, i) => (
          <div key={color} className="flex items-center gap-2.5">
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-sm border border-black/5"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <span className="text-[11px] font-medium text-slate-600">{data.labels[i]}</span>
          </div>
        ))}
      </div>

      {/* Opacité de la nappe principale */}
      <div className="flex items-center gap-2 border-t border-slate-200/80 pt-2">
        <label htmlFor="legend-opacity" className="text-[10px] font-medium text-slate-500">
          Opacity
        </label>
        <input
          id="legend-opacity"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-lg bg-slate-200 accent-slate-700"
          aria-valuetext={`${Math.round(opacity * 100)}%`}
        />
        <span className="w-7 text-right font-mono text-[10px] tabular-nums text-slate-500">
          {Math.round(opacity * 100)}%
        </span>
      </div>

      {!recitOnTop && (
        <button
          type="button"
          onClick={() => setRecitOnTop(true)}
          className="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-900"
        >
          Bring this layer to the front
        </button>
      )}

      {/* Source officielle */}
      <div className="border-t border-slate-200/80 pt-1.5 text-[10px] text-slate-500">
        <button
          type="button"
          onClick={() => setShowSource((v) => !v)}
          aria-expanded={showSource}
          className="flex w-full items-center justify-between transition-colors hover:text-slate-600"
        >
          <span>Official source</span>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showSource && 'rotate-180')} aria-hidden />
        </button>
        {showSource && (
          <p className="mt-1 leading-snug text-slate-500 italic">{INDICATOR_SOURCES[indicator]}</p>
        )}
      </div>
    </article>
  );
}
