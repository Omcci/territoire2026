import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, GripVertical, Lock, X } from 'lucide-react';
import {
  PIVOT_YEARS,
  SCENARIOS,
  SCENARIO_SHORT_LABELS,
  INDICATOR_LABELS,
  type Indicator,
  type Scenario,
} from '../../lib/metricsTypes';
import { ALEA_PALETTES, INDICATOR_SOURCES, LEVEL_WORDS } from '../../lib/palettes';
import { cn } from '../../lib/utils';
import { useAppStore, type FreeNavLayerInstance } from '../../store/useAppStore';

interface CardProps {
  title: string;
  indicator: Indicator;
  isRecitCard: boolean;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  freeLayer?: FreeNavLayerInstance;
  dragId?: string;
}

export default function LegendLayerCard({
  title,
  indicator,
  isRecitCard,
  opacity,
  onOpacityChange,
  freeLayer,
  dragId,
}: CardProps) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const setFreeNavLayerParam = useAppStore((s) => s.setFreeNavLayerParam);
  const removeFreeNavLayer = useAppStore((s) => s.removeFreeNavLayer);
  const recitOnTop = useAppStore((s) => s.recitOnTop);
  const setRecitOnTop = useAppStore((s) => s.setRecitOnTop);

  const sortable = useSortable({ id: dragId ?? `recit-card`, disabled: isRecitCard });
  const style = isRecitCard
    ? undefined
    : { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };

  const colors = ALEA_PALETTES[indicator];

  return (
    <article
      ref={isRecitCard ? undefined : sortable.setNodeRef}
      style={style}
      className={cn(
        'glass-panel panneau-entree rounded-2xl p-3.5',
        sortable.isDragging && 'opacity-70',
      )}
      aria-label={`Legend — ${title}`}
    >
      <div className="flex items-center gap-1.5">
        {!isRecitCard && (
          <button
            type="button"
            {...sortable.attributes}
            {...sortable.listeners}
            aria-label={`Move layer ${title}`}
            className="cursor-grab touch-none text-slate-500 hover:text-slate-600"
          >
            <GripVertical className="h-4 w-4" aria-hidden />
          </button>
        )}
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{title}</h3>
        {isRecitCard && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
            Main layer
          </span>
        )}
        {!isRecitCard && freeLayer && (
          <button
            type="button"
            onClick={() => removeFreeNavLayer(freeLayer.id)}
            aria-label={`Remove layer ${title}`}
            className="rounded-full bg-slate-100 p-1 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      {/* Micro-dropdowns : couches libres uniquement, jamais la carte récit. */}
      {!isRecitCard && freeLayer && (
        <div className="mt-2.5 flex h-[27px] items-center gap-1.5">
          <label className="sr-only" htmlFor={`${freeLayer.id}-year`}>Layer year {title}</label>
          <select
            id={`${freeLayer.id}-year`}
            value={freeLayer.year}
            onChange={(e) => setFreeNavLayerParam(freeLayer.id, { year: Number(e.target.value) })}
            className="h-[27px] rounded-full border border-white/60 bg-white/50 px-2 text-xs font-medium text-slate-700"
          >
            {PIVOT_YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor={`${freeLayer.id}-scenario`}>Layer pathway {title}</label>
          <select
            id={`${freeLayer.id}-scenario`}
            value={freeLayer.scenario}
            onChange={(e) => setFreeNavLayerParam(freeLayer.id, { scenario: e.target.value as Scenario })}
            className="h-[27px] min-w-0 flex-1 rounded-full border border-white/60 bg-white/50 px-2 text-xs font-medium text-slate-700"
          >
            {SCENARIOS.map((s) => (
              <option key={s} value={s}>{SCENARIO_SHORT_LABELS[s]}</option>
            ))}
          </select>
        </div>
      )}

      {/* Échelle de couleurs */}
      <div className="mt-3 flex overflow-hidden rounded-md" aria-hidden>
        {colors.map((color) => (
          <span key={color} className="h-2.5 flex-1 border-y border-black/5 first:rounded-l-md last:rounded-r-md" style={{ backgroundColor: color }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-medium text-slate-500">
        <span>{LEVEL_WORDS[0]}</span>
        <span>{LEVEL_WORDS[3]}</span>
        <span>{LEVEL_WORDS[6]}</span>
      </div>

      {/* Opacité : toutes les cartes, récit compris. */}
      <div className="mt-3 flex items-center gap-2">
        <label htmlFor={`opacity-${dragId ?? 'recit'}`} className="text-[11px] text-slate-500">
          Opacity
        </label>
        <input
          id={`opacity-${dragId ?? 'recit'}`}
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(opacity * 100)}
          onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
          className="min-w-0 flex-1 accent-slate-100"
          aria-valuetext={`${Math.round(opacity * 100)}%`}
        />
        <span className="w-9 text-right font-mono text-[11px] tabular-nums text-slate-500">
          {Math.round(opacity * 100)}%
        </span>
      </div>

      {isRecitCard && !recitOnTop && (
        <button
          type="button"
          onClick={() => setRecitOnTop(true)}
          className="mt-2.5 w-full rounded-full bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-900"
        >
          Bring this layer to the front
        </button>
      )}

      {/* Source officielle */}
      <button
        type="button"
        onClick={() => setSourceOpen((v) => !v)}
        aria-expanded={sourceOpen}
        className="mt-2.5 flex w-full items-center justify-between text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-600"
      >
        <span className="flex items-center gap-1">
          {isRecitCard ? 'Data source' : 'Official source'}
          {isRecitCard && <Lock className="h-3 w-3 text-slate-500" aria-hidden />}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', sourceOpen && 'rotate-180')} aria-hidden />
      </button>
      {sourceOpen && (
        <p className="mt-1.5 text-xs font-light leading-relaxed text-slate-500">
          {INDICATOR_SOURCES[indicator]}
          {isRecitCard && ' — year and pathway settings are in the bottom bar.'}
        </p>
      )}
      <p className="sr-only">{INDICATOR_LABELS[indicator]}</p>
    </article>
  );
}
