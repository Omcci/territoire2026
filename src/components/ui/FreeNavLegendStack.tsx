import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { INDICATOR_LABELS } from '../../lib/metricsTypes';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/useAppStore';
import Legend from './Legend';
import LegendLayerCard from './LegendLayerCard';

/**
 * Pile de légende unifiée, à droite : carte récit (toujours présente,
 * non déplaçable) + cartes des couches libres réordonnables en glisser-déposer.
 * La première carte libre de la pile est dessinée au-dessus des autres.
 */
export default function FreeNavLegendStack() {
  const recitOnTop = useAppStore((s) => s.recitOnTop);
  const freeNavLayers = useAppStore((s) => s.freeNavLayers);
  const reorderFreeNavLayers = useAppStore((s) => s.reorderFreeNavLayers);
  const selectedCommune = useAppStore((s) => s.selectedCommune);
  const donneesPanelOpen = useAppStore((s) => s.donneesPanelOpen);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // La pile ne disparaît jamais : elle se décale pour coexister avec la
  // fiche commune (à droite) et le catalogue Données (au-dessus).

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = freeNavLayers.map((l) => l.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    reorderFreeNavLayers(next);
  };

  return (
    <div
      className={cn(
        'pointer-events-auto absolute right-4 top-20 flex max-h-[calc(100vh-16rem)] w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto pb-1 transition-all duration-200 ease-out max-sm:top-[9.5rem] max-sm:max-h-[32vh]',
        donneesPanelOpen && 'top-[28rem] max-h-[calc(100vh-34rem)] max-sm:translate-y-[25rem]',
        selectedCommune && 'xl:right-[26rem]',
      )}
      aria-label="Displayed layers and legends"
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={freeNavLayers.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {freeNavLayers.map((layer) => (
            <LegendLayerCard
              key={layer.id}
              dragId={layer.id}
              title={`${INDICATOR_LABELS[layer.indicator]} · ${layer.year}`}
              indicator={layer.indicator}
              isRecitCard={false}
              opacity={layer.opacity}
              onOpacityChange={(opacity) =>
                useAppStore.getState().setFreeNavLayerParam(layer.id, { opacity })
              }
              freeLayer={layer}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* Carte récit = légende quantifiée MAB, sous les libres si recitOnTop est faux. */}
      <div className={recitOnTop ? 'order-first' : ''}>
        <Legend />
      </div>
    </div>
  );
}
