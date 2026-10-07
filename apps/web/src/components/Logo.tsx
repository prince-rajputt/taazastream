export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ts-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff8a4c" />
          <stop offset="0.55" stopColor="#ff6b35" />
          <stop offset="1" stopColor="#ff3d7f" />
        </linearGradient>
      </defs>
      <path
        d="M18 14.5c0-2.6 2.8-4.2 5.1-2.8l26.2 15.9c2.2 1.4 2.2 4.6 0 6L23.1 49.5c-2.3 1.4-5.1-.2-5.1-2.8Z"
        fill="url(#ts-logo-g)"
      />
      <path d="M18 31.5c7-8 17.5-10.4 28-7.6" stroke="#08080d" strokeWidth="3.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 select-none" aria-label="TaazaStream">
      <LogoMark className="h-7 w-7 md:h-8 md:w-8" />
      {!compact && (
        <span className="font-display text-xl leading-none font-bold tracking-tight md:text-2xl">
          <span className="text-gradient-brand">taaza</span>
          <span className="font-light text-fg">stream</span>
        </span>
      )}
    </span>
  );
}
