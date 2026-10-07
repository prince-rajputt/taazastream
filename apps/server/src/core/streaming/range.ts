export interface ByteRange {
  start: number;
  end: number;
}

export type RangeResult =
  { type: 'full' } | { type: 'partial'; range: ByteRange } | { type: 'unsatisfiable' };

/**
 * Parse an HTTP `Range` header for a resource of `size` bytes (RFC 9110 §14).
 * Supports `bytes=a-b`, `bytes=a-` and `bytes=-n`. When several ranges are requested only the
 * first is honoured (browsers never send multi-range requests for media).
 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return { type: 'full' };
  const m = /^\s*bytes\s*=\s*(.+)$/i.exec(header);
  if (!m?.[1]) return { type: 'full' }; // unknown unit → ignore per spec
  const first = m[1].split(',')[0]!.trim();
  const parts = /^(\d*)\s*-\s*(\d*)$/.exec(first);
  if (!parts) return { type: 'unsatisfiable' };
  const [, a = '', b = ''] = parts;
  if (a === '' && b === '') return { type: 'unsatisfiable' };
  if (size === 0) return { type: 'unsatisfiable' };

  let start: number;
  let end: number;
  if (a === '') {
    // suffix range: last N bytes
    const n = Number(b);
    if (!Number.isSafeInteger(n) || n === 0) return { type: 'unsatisfiable' };
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end))
      return { type: 'unsatisfiable' };
    if (start >= size || end < start) return { type: 'unsatisfiable' };
  }
  return { type: 'partial', range: { start, end } };
}

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mts: 'video/mp2t',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp',
};

export function videoMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}
