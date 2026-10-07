/** 4363 -> "1:12:43", 95 -> "1:35". */
export function formatTimecode(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** 8040 -> "2h 14m", 2700 -> "45m". */
export function formatRuntime(totalSeconds: number | null | undefined): string {
  if (!totalSeconds || totalSeconds <= 0) return '';
  const minutes = Math.round(totalSeconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${Math.max(m, 1)}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / 1024 ** i;
  return `${v.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function formatBitrate(bitsPerSecond: number): string {
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return '0 bps';
  if (bitsPerSecond >= 1e9) return `${(bitsPerSecond / 1e9).toFixed(2)} Gbps`;
  if (bitsPerSecond >= 1e6) return `${(bitsPerSecond / 1e6).toFixed(1)} Mbps`;
  if (bitsPerSecond >= 1e3) return `${(bitsPerSecond / 1e3).toFixed(0)} kbps`;
  return `${Math.round(bitsPerSecond)} bps`;
}

/** URL-safe slug used for genre links. */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

const ACCENTS = [
  '#f97316',
  '#ef4444',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
];

/** Deterministic, pleasant accent colour for titles without artwork. */
export function accentFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return ACCENTS[Math.abs(hash) % ACCENTS.length]!;
}

/** Progress is "finished" once at least 95% is watched (or under 3 minutes remain of a long video). */
export function isWatched(positionSec: number, durationSec: number): boolean {
  if (durationSec <= 0) return false;
  const remaining = durationSec - positionSec;
  return positionSec / durationSec >= 0.95 || (durationSec > 1200 && remaining < 180);
}

/** Below this position we treat the title as "not started". */
export const MIN_RESUME_SECONDS = 15;
