import { BookOpen, Compass, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

/**
 * Invitation d'entrée : carte neutre, aucun récit ni couche active.
 * Deux actions — découvrir les récits (chapitre 1, couche cohérente)
 * ou explorer librement (choix des données sans récit imposé).
 * Fermable : la carte reste alors neutre jusqu'au premier réglage.
 */
export default function WelcomeOverlay() {
  const entryChoice = useAppStore((s) => s.entryChoice);
  const enterStories = useAppStore((s) => s.enterStories);
  const enterExplore = useAppStore((s) => s.enterExplore);
  const closeWelcome = useAppStore((s) => s.closeWelcome);

  if (entryChoice !== 'pending') return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center p-4 pb-28 sm:items-center sm:pb-4">
      <section
        aria-label="Welcome to Territoires 2100"
        className="glass-strong panneau-entree pointer-events-auto relative w-full max-w-md rounded-3xl p-6 text-slate-900"
      >
        <button
          type="button"
          onClick={closeWelcome}
          aria-label="Close the invitation and view the map"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <h2 className="font-serif text-[22px] font-semibold leading-snug tracking-[-0.01em]">
          Reading a changing France, municipality by municipality
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Extreme heat, clay shrink-swell, flooding, water: explore the climate
          risks facing 35,000 municipalities, from 1990 to 2100, or let the stories guide you.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={enterStories}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-colors hover:bg-slate-700"
          >
            <BookOpen className="h-4 w-4" aria-hidden />
            Discover the stories
          </button>
          <button
            type="button"
            onClick={enterExplore}
            className="flex flex-1 items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <Compass className="h-4 w-4" aria-hidden />
            Explore freely
          </button>
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
          Demonstration data — emissions-pathway projections, not forecasts.
        </p>
      </section>
    </div>
  );
}
