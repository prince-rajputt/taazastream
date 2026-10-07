import { AlertTriangle, Film, RefreshCw, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '../lib/api';

export function RowSkeleton({ variant = 'poster' }: { variant?: 'poster' | 'landscape' }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="page-x">
        <div className="skeleton h-6 w-44 rounded-md" />
      </div>
      <div data-variant={variant} className="row-track page-x flex overflow-hidden">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i}>
            <div className={`skeleton rounded-[var(--radius-card)] ${variant === 'poster' ? 'aspect-[2/3]' : 'aspect-video'}`} />
            <div className="skeleton mt-2 h-3.5 w-3/4 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function HeroSkeleton() {
  return (
    <div className="relative h-[72svh] min-h-[420px] w-full md:h-[86svh]" aria-hidden="true">
      <div className="skeleton absolute inset-0" />
      <div className="page-x absolute bottom-[18%] w-full max-w-2xl space-y-4">
        <div className="skeleton h-12 w-2/3 rounded-lg" />
        <div className="skeleton h-4 w-1/2 rounded" />
        <div className="skeleton h-4 w-5/6 rounded" />
        <div className="flex gap-3 pt-2">
          <div className="skeleton h-12 w-32 rounded-full" />
          <div className="skeleton h-12 w-36 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 18 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="skeleton aspect-[2/3] rounded-[var(--radius-card)]" />
          <div className="skeleton mt-2 h-3.5 w-3/4 rounded" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-16 text-center animate-rise-in">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-surface text-brand-400">
        {icon ?? <Film className="h-7 w-7" />}
      </div>
      <h2 className="font-display text-xl font-semibold md:text-2xl">{title}</h2>
      {children && <div className="mt-2 text-sm leading-relaxed text-muted md:text-base">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const network = error instanceof ApiError && error.isNetwork;
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <EmptyState
      icon={network ? <WifiOff className="h-7 w-7" /> : <AlertTriangle className="h-7 w-7" />}
      title={network ? 'Can’t reach your TaazaStream server' : 'Something went wrong'}
      action={
        onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-full border border-line-strong px-5 py-2.5 text-sm font-medium transition hover:bg-white/10">
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        )
      }
    >
      {network ? 'Make sure this device is on the same Wi-Fi as the server PC and that TaazaStream is running.' : message}
    </EmptyState>
  );
}

export function Spinner({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <div className={`${className} animate-spin rounded-full border-[3px] border-white/15 border-t-brand-500`} role="status" aria-label="Loading" />
  );
}
