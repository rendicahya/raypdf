// Aligning and distributing items placed on a page, in canvas pixels. Items
// are compared by what's seen: a turned signature by the box around it as
// turned, not its unturned box. Only positions change, never sizes.

export interface ArrangeItem {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees clockwise about the centre (signatures). */
  angle?: number;
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type Axis = 'horizontal' | 'vertical';

/** The box around an item as shown. */
export function visualBounds(item: ArrangeItem): Bounds {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  let hw = item.width / 2;
  let hh = item.height / 2;
  if (item.angle) {
    const a = (item.angle * Math.PI) / 180;
    const cos = Math.abs(Math.cos(a));
    const sin = Math.abs(Math.sin(a));
    [hw, hh] = [hw * cos + hh * sin, hw * sin + hh * cos];
  }
  return { left: cx - hw, top: cy - hh, right: cx + hw, bottom: cy + hh };
}

export function unionBounds(bounds: Bounds[]): Bounds {
  return {
    left: Math.min(...bounds.map((b) => b.left)),
    top: Math.min(...bounds.map((b) => b.top)),
    right: Math.max(...bounds.map((b) => b.right)),
    bottom: Math.max(...bounds.map((b) => b.bottom)),
  };
}

/**
 * How far to move each item (same order) to line them up along `edge` of
 * `target`: the selection's bounds, or the page for a single item.
 */
export function alignOffsets(items: ArrangeItem[], edge: Alignment, target: Bounds): { dx: number; dy: number }[] {
  return items.map((item) => {
    const b = visualBounds(item);
    switch (edge) {
      case 'left':
        return { dx: target.left - b.left, dy: 0 };
      case 'right':
        return { dx: target.right - b.right, dy: 0 };
      case 'center':
        return { dx: (target.left + target.right) / 2 - (b.left + b.right) / 2, dy: 0 };
      case 'top':
        return { dx: 0, dy: target.top - b.top };
      case 'bottom':
        return { dx: 0, dy: target.bottom - b.bottom };
      case 'middle':
        return { dx: 0, dy: (target.top + target.bottom) / 2 - (b.top + b.bottom) / 2 };
    }
  });
}

/**
 * Spreads items so the gaps between neighbours are equal, keeping the
 * outermost edges where they are. Needs three or more items.
 */
export function distributeOffsets(items: ArrangeItem[], axis: Axis): { dx: number; dy: number }[] {
  const offsets = items.map(() => ({ dx: 0, dy: 0 }));
  if (items.length < 3) return offsets;
  const horizontal = axis === 'horizontal';
  const spans = items.map((item, index) => {
    const b = visualBounds(item);
    return horizontal ? { index, start: b.left, size: b.right - b.left } : { index, start: b.top, size: b.bottom - b.top };
  });
  // By centre, so an item inside a wider one still has a sensible place in line.
  spans.sort((a, b) => a.start + a.size / 2 - (b.start + b.size / 2));
  const first = Math.min(...spans.map((s) => s.start));
  const last = Math.max(...spans.map((s) => s.start + s.size));
  const total = spans.reduce((sum, s) => sum + s.size, 0);
  const gap = (last - first - total) / (spans.length - 1);
  let at = first;
  for (const s of spans) {
    const delta = at - s.start;
    offsets[s.index] = horizontal ? { dx: delta, dy: 0 } : { dx: 0, dy: delta };
    at += s.size + gap;
  }
  return offsets;
}
