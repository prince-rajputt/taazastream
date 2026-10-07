import { useState } from 'react';

interface ArtworkProps {
  src: string | null | undefined;
  alt: string;
  accent: string;
  className?: string;
  /** Text drawn on the generated placeholder when no artwork exists. */
  title?: string;
  /** Load eagerly (hero, above the fold). */
  priority?: boolean;
  /** For portrait cards: draw the title over the image as a designed poster. */
  designed?: boolean;
  sizes?: string;
}

/**
 * Lazy-loading artwork with a fade-in and a generated, on-brand placeholder.
 * Every image is served by the local server (WebP); nothing is fetched from the internet.
 */
export function Artwork({
  src,
  alt,
  accent,
  className = '',
  title,
  priority,
  designed,
}: ArtworkProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const showImg = !!src && !failed;

  return (
    <div
      className={`relative overflow-hidden bg-surface ${className}`}
      style={{
        backgroundImage: `radial-gradient(120% 90% at 15% 10%, ${accent}55 0%, transparent 55%), linear-gradient(160deg, ${accent}33, #0d0d14 70%)`,
      }}
    >
      {showImg && (
        <img
          src={src}
          alt={designed ? '' : alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {(designed || !showImg) && title && (
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/25 to-transparent p-3">
          <span className="font-display text-[clamp(0.85rem,1.4vw,1.2rem)] leading-tight font-semibold text-balance text-white drop-shadow-lg line-clamp-3">
            {title}
          </span>
          <span className="mt-1.5 block h-0.5 w-8 rounded-full" style={{ background: accent }} />
        </div>
      )}
    </div>
  );
}
