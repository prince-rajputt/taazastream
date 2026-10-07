/**
 * Minimal spatial navigation for TV remotes and keyboards: the arrow keys move focus to the
 * nearest focusable element in that direction. Text inputs, sliders and the video player keep
 * their own arrow-key behaviour.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), select, input:not([type="hidden"]), textarea, [data-focusable]';

type Dir = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function center(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function findNext(from: HTMLElement, dir: Dir): HTMLElement | null {
  const scope = (from.closest('[data-nav-scope]') as HTMLElement | null) ?? document.body;
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el !== from && visible(el));
  const fr = from.getBoundingClientRect();
  const fc = center(fr);
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const c = center(r);
    const dx = c.x - fc.x;
    const dy = c.y - fc.y;
    let primary: number;
    let secondary: number;
    switch (dir) {
      case 'ArrowRight':
        if (r.left < fr.right - 4) continue;
        primary = dx;
        secondary = Math.abs(dy);
        break;
      case 'ArrowLeft':
        if (r.right > fr.left + 4) continue;
        primary = -dx;
        secondary = Math.abs(dy);
        break;
      case 'ArrowDown':
        if (r.top < fr.bottom - 4) continue;
        primary = dy;
        secondary = Math.abs(dx);
        break;
      default:
        if (r.bottom > fr.top + 4) continue;
        primary = -dy;
        secondary = Math.abs(dx);
    }
    // Strongly prefer elements aligned on the cross axis (same row / same column).
    const score = primary + secondary * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

export function installSpatialNavigation(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body) {
      const first = document.querySelector<HTMLElement>('main ' + FOCUSABLE);
      if (first) {
        first.focus();
        e.preventDefault();
      }
      return;
    }
    if (active.closest('[data-no-spatial]')) return;
    const tag = active.tagName;
    const type = (active as HTMLInputElement).type;
    if ((tag === 'INPUT' && type !== 'checkbox' && type !== 'radio') || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || type === 'range') return;
    }
    const next = findNext(active, e.key as Dir);
    if (next) {
      e.preventDefault();
      next.focus({ preventScroll: false });
      next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
