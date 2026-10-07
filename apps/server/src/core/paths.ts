import { realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * Filesystem safety helpers.
 *
 * The browser never sends filesystem paths for media. Paths only enter the system through
 * (a) admin-registered media folders and (b) the scanner walking those folders. Every file
 * that is opened is re-checked to be inside a registered folder, after resolving symlinks.
 */

const isWindows = process.platform === 'win32';

function normalizeForCompare(p: string): string {
  const n = path.resolve(p);
  return isWindows ? n.toLowerCase() : n;
}

/** True when `child` is `parent` or lies beneath it (no `..` escape). */
export function isInside(parent: string, child: string): boolean {
  const p = normalizeForCompare(parent);
  const c = normalizeForCompare(child);
  if (c === p) return true;
  const rel = path.relative(p, c);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Resolve symlinks/junctions; falls back to the plain resolved path when the file is missing. */
export function realPathOrResolved(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** True when `filePath`, after resolving links, is inside one of `roots`. */
export function isInsideAny(roots: string[], filePath: string): boolean {
  const real = realPathOrResolved(filePath);
  return roots.some((root) => isInside(realPathOrResolved(root), real));
}

/**
 * Validates a single path segment coming from a URL (e.g. an image or segment file name).
 * Allows only a strict character set, so `..`, slashes, drive letters, NUL etc. are rejected.
 */
export function safeFileName(name: string, pattern = /^[a-zA-Z0-9_-]{1,128}\.[a-z0-9]{1,8}$/): boolean {
  return pattern.test(name) && !name.includes('..');
}

/** Join a validated file name to a base directory and verify the result stays inside it. */
export function joinInside(baseDir: string, fileName: string): string | null {
  if (!safeFileName(fileName)) return null;
  const full = path.join(baseDir, fileName);
  return isInside(baseDir, full) ? full : null;
}

/** Paths that should never be registered as a media folder. */
export function isForbiddenMediaRoot(p: string): boolean {
  const n = normalizeForCompare(p).replace(/[\\/]+$/, '');
  if (isWindows) {
    if (/^[a-z]:$/.test(n)) return false; // whole drives such as E:\ are fine
    const blocked = ['c:\\windows', 'c:\\program files', 'c:\\program files (x86)', 'c:\\programdata'];
    return blocked.some((b) => n === b || n.startsWith(`${b}\\`));
  }
  const blocked = ['/etc', '/proc', '/sys', '/dev', '/boot', '/bin', '/sbin', '/usr', '/root'];
  return n === '/' || blocked.some((b) => n === b || n.startsWith(`${b}/`));
}
