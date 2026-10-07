import { X } from 'lucide-react';
import {
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-surface/80 p-5 md:p-6 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="font-display text-base font-semibold md:text-lg">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const toneClass =
    tone === 'bad'
      ? 'text-bad'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'ok'
          ? 'text-ok'
          : 'text-brand-400';
  return (
    <div className="rounded-2xl border border-line bg-surface/80 p-4 md:p-5">
      <div className="flex items-center justify-between text-xs font-medium tracking-wide text-muted uppercase">
        {label}
        {icon && <span className={toneClass}>{icon}</span>}
      </div>
      <div className="mt-2 font-display text-2xl font-semibold tabular-nums md:text-3xl">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </div>
  );
}

export function Meter({ value, tone }: { value: number; tone?: 'auto' }) {
  const v = Math.max(0, Math.min(1, value));
  const color =
    tone === 'auto'
      ? v > 0.9
        ? 'bg-bad'
        : v > 0.75
          ? 'bg-warn'
          : 'bg-gradient-brand'
      : 'bg-gradient-brand';
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-white/10"
      role="meter"
      aria-valuenow={Math.round(v * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full ${color} transition-[width] duration-700`}
        style={{ width: `${v * 100}%` }}
      />
    </div>
  );
}

/** Tiny dependency-free sparkline for live network throughput. */
export function Sparkline({
  points,
  height = 64,
  label,
}: {
  points: number[];
  height?: number;
  label: string;
}) {
  const w = 300;
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - (p / max) * (height - 4) - 2).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className="h-16 w-full"
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ff6b35" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ff6b35" stopOpacity="0" />
        </linearGradient>
      </defs>
      {points.length > 1 && (
        <>
          <path d={`${path} L${w},${height} L0,${height} Z`} fill="url(#spark-fill)" />
          <path
            d={path}
            fill="none"
            stroke="#ff8a4c"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'brand';
}) {
  const cls = {
    neutral: 'bg-white/8 text-white/75 border-white/10',
    ok: 'bg-ok/12 text-ok border-ok/25',
    warn: 'bg-warn/12 text-warn border-warn/25',
    bad: 'bg-bad/12 text-bad border-bad/25',
    brand: 'bg-brand-500/12 text-brand-300 border-brand-500/25',
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};
export function Button({ variant = 'secondary', size = 'md', className = '', ...props }: BtnProps) {
  const v = {
    primary: 'bg-gradient-brand text-white shadow-lg shadow-brand-600/20 hover:brightness-110',
    secondary: 'border border-line-strong bg-white/5 hover:bg-white/10',
    ghost: 'hover:bg-white/10',
    danger: 'border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20',
  }[variant];
  const s = size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm';
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:opacity-50 ${v} ${s} ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-white/85">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-faint">{hint}</p>}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-line bg-ink-2 px-3 text-sm text-fg outline-none transition placeholder:text-faint focus:border-brand-500/70';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`h-10 ${inputCls} ${props.className ?? ''}`} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`h-10 ${inputCls} ${props.className ?? ''}`} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`min-h-24 py-2 ${inputCls} ${props.className ?? ''}`} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium text-white/85">{label}</span>
        {description && <span className="block text-xs text-faint">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition ${checked ? 'bg-brand-500' : 'bg-white/20'}`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'translate-x-5' : ''}`}
        />
      </button>
    </label>
  );
}

/** Slide-over panel (library editor, folder picker). */
export function Drawer({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
      data-nav-scope
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        className={`relative flex h-full w-full flex-col border-l border-line bg-ink-2 shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-xl'}`}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
