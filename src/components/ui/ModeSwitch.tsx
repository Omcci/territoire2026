import { BookOpen, Compass } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/useAppStore';

/** Switch Récit / Exploration : segment vertical du rail de contrôles flottant. */
export default function ModeSwitch() {
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);

  return (
    <div
      className="glass-panel pointer-events-auto flex flex-col items-center gap-1 rounded-full p-1.5"
      role="tablist"
      aria-label="Display mode"
    >
      {(
        [
          { value: 'STORY', label: 'Story', Icon: BookOpen },
          { value: 'EXPLORE', label: 'Explore', Icon: Compass },
        ] as const
      ).map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          aria-label={label}
          title={label}
          onClick={() => setMode(value)}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
            mode === value ? 'bg-slate-900 text-white shadow-md' : 'text-slate-700 hover:bg-white/60 hover:text-slate-900',
          )}
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </button>
      ))}
    </div>
  );
}
