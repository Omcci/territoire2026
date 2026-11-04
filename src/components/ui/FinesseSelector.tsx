import { Building2, Globe2, MapPin } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAppStore, type FinesseLevel } from '../../store/useAppStore';

const LEVELS: { key: FinesseLevel; label: string; Icon: typeof Globe2 }[] = [
  { key: 'national', label: 'National (Dept.)', Icon: Globe2 },
  { key: 'regional', label: 'Regional', Icon: MapPin },
  { key: 'communal', label: 'Municipal & 3D', Icon: Building2 },
];

/**
 * Sélecteur de finesse cartographique. Chaque niveau a une lecture propre :
 * national = départements, régional = limites régionales cliquables,
 * communal = communes et bâtiments. Le niveau communal zoome sur le centre
 * courant de la carte (pas sur une ville arbitraire).
 */
export default function FinesseSelector() {
  const currentLevel = useAppStore((s) => s.currentLevel);
  const setLevel = useAppStore((s) => s.setLevel);
  const flyToLevel = useAppStore((s) => s.flyToLevel);
  const cameraCenter = useAppStore((s) => s.cameraCenter);
  const setSelectedRegion = useAppStore((s) => s.setSelectedRegion);

  const goTo = (key: FinesseLevel): void => {
    setLevel(key);
    if (key === 'national') {
      setSelectedRegion(null);
      flyToLevel(5.8, [2.2137, 46.2276]);
    } else if (key === 'regional') {
      // La France entière avec les limites régionales : zoom dans la bande
      // régionale de la carte (6,2–12, cf. HybridMap3D).
      flyToLevel(6.4, [2.6, 46.9]);
    } else {
      flyToLevel(13.5, cameraCenter);
    }
  };

  return (
    <div
      className="glass-panel pointer-events-auto flex flex-col items-center gap-1 rounded-full p-1.5"
      role="group"
      aria-label="Map detail level"
    >
      {LEVELS.map((lvl) => (
        <button
          key={lvl.key}
          type="button"
          aria-pressed={currentLevel === lvl.key}
          aria-label={lvl.label}
          title={lvl.label}
          onClick={() => goTo(lvl.key)}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
            currentLevel === lvl.key
              ? 'bg-slate-900 text-white shadow-md'
              : 'text-slate-700 hover:bg-white/60 hover:text-slate-900',
          )}
        >
          <lvl.Icon className="h-[18px] w-[18px]" aria-hidden />
        </button>
      ))}
    </div>
  );
}
