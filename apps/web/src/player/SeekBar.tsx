import { formatTimecode } from '@taazastream/shared';
import { useRef, useState } from 'react';

interface SeekBarProps {
  current: number;
  duration: number;
  buffered: number;
  onSeek: (t: number) => void;
  onScrub?: (scrubbing: boolean) => void;
}

/** Pointer/touch friendly seek bar with buffered range and time preview. */
export function SeekBar({ current, duration, buffered, onSeek, onScrub }: SeekBarProps) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const timeAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return f * (duration || 0);
  };

  const shown = drag ?? current;
  const pct = duration > 0 ? (shown / duration) * 100 : 0;
  const bufPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;
  const preview = drag ?? hover;

  return (
    <div
      ref={bar}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${formatTimecode(shown)} of ${formatTimecode(duration)}`}
      className="group/seek relative flex h-6 cursor-pointer touch-none items-center"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setDrag(timeAt(e.clientX));
        onScrub?.(true);
      }}
      onPointerMove={(e) => {
        const t = timeAt(e.clientX);
        setHover(t);
        if (drag != null) setDrag(t);
      }}
      onPointerUp={(e) => {
        if (drag != null) onSeek(timeAt(e.clientX));
        setDrag(null);
        onScrub?.(false);
      }}
      onPointerCancel={() => {
        setDrag(null);
        onScrub?.(false);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25 transition-[height] group-hover/seek:h-1.5">
        <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${bufPct}%` }} />
        <div className="absolute inset-y-0 left-0 bg-gradient-brand" style={{ width: `${pct}%` }} />
      </div>
      <div
        className={`pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-white shadow transition-transform group-hover/seek:scale-100 group-focus-visible/seek:scale-100 ${
          drag != null ? 'scale-125' : 'scale-0'
        }`}
        style={{ left: `${pct}%` }}
      />
      {preview != null && duration > 0 && (
        <div
          className="pointer-events-none absolute -top-9 -translate-x-1/2 rounded-md bg-black/85 px-2 py-1 font-mono text-xs text-white"
          style={{ left: `${(preview / duration) * 100}%` }}
        >
          {formatTimecode(preview)}
        </div>
      )}
    </div>
  );
}
