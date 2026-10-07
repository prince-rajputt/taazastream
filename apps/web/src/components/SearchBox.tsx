import { Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useDebounced } from '../lib/hooks';
import { useSuggestions } from '../lib/queries';
import { hrefFor } from './TitleCard';

/** Header search with instant local suggestions (SQLite FTS on the server, works offline). */
export function SearchBox({ initial = '', autoFocus = false, onDone }: { initial?: string; autoFocus?: boolean; onDone?: () => void }) {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebounced(value, 150);
  const { data: suggestions = [] } = useSuggestions(debounced);
  const navigate = useNavigate();
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const submit = (q: string) => {
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
    onDone?.();
  };

  const show = open && value.trim().length > 0 && suggestions.length > 0;

  return (
    <div ref={wrap} className="relative w-full" data-no-spatial={show ? '' : undefined}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const pick = active >= 0 ? suggestions[active] : undefined;
          if (pick) {
            setOpen(false);
            navigate(hrefFor(pick));
            onDone?.();
          } else if (value.trim()) submit(value);
        }}
      >
        <label className="glass flex h-10 items-center gap-2 rounded-full px-3.5 transition focus-within:border-white/30 focus-within:bg-surface/90">
          <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <span className="sr-only">Search titles, genres, cast</span>
          <input
            type="search"
            value={value}
            autoFocus={autoFocus}
            onChange={(e) => {
              setValue(e.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (!show) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, suggestions.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, -1));
              } else if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Titles, genres, cast, year"
            className="w-full min-w-0 bg-transparent text-sm text-fg outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
            role="combobox"
            aria-expanded={show}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          />
          {value && (
            <button type="button" aria-label="Clear search" onClick={() => setValue('')} className="text-muted hover:text-fg">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </form>
      {show && (
        <ul id={listId} role="listbox" className="glass absolute top-12 right-0 left-0 z-50 overflow-hidden rounded-2xl py-1.5 shadow-2xl shadow-black/60 animate-fade-in">
          {suggestions.map((s, i) => (
            <li key={`${s.kind}-${s.id}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  setOpen(false);
                  navigate(hrefFor(s));
                  onDone?.();
                }}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition ${i === active ? 'bg-white/10' : ''}`}
              >
                <span className="h-12 w-8 shrink-0 overflow-hidden rounded" style={{ background: s.accent }}>
                  {s.posterUrl && <img src={s.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{s.title}</span>
                  <span className="block text-xs text-muted">
                    {s.kind === 'series' ? 'Series' : 'Movie'}
                    {s.year ? ` · ${s.year}` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => submit(value)} className="w-full border-t border-line px-3 py-2.5 text-left text-sm text-brand-300 hover:bg-white/5">
              See all results for “{value.trim()}”
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
