/** Moving and resizing boxes placed on a page, in canvas pixels. */

/** How far an arrow key moves a selected item. */
export const KEYBOARD_MOVE_STEP = 10;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type Size = { width: number; height: number };
type ResizeStart = { x: number; y: number; width: number; height: number; pointerX: number; pointerY: number };
type Modifiers = { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; clientX: number; clientY: number };

/**
 * Holding Ctrl (Cmd on a Mac) while resizing keeps the box's proportions
 * from when the drag began, as far as `maxHeight` allows.
 */
export function withAspect(e: Modifiers, start: Size, width: number, height: number, maxHeight: number): Size {
  if (!(e.ctrlKey || e.metaKey) || start.width <= 0 || start.height <= 0) return { width, height };
  const aspect = start.width / start.height;
  height = width / aspect;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspect;
  }
  return { width, height };
}

/**
 * Resizing a plain, unturned box by its bottom-right handle, within `bounds`
 * (the page): it grows from its top-left corner, or from its centre while
 * Shift is held (the opposite sides move too), and keeps its proportions
 * while Ctrl is held.
 */
export function resizedBox(
  e: Modifiers,
  start: ResizeStart,
  minWidth: number,
  minHeight: number,
  bounds: Size,
): { x: number; y: number; width: number; height: number } {
  const fromCentre = e.shiftKey;
  const grow = fromCentre ? 2 : 1;
  const cx = start.x + start.width / 2;
  const cy = start.y + start.height / 2;
  const maxWidth = fromCentre ? 2 * Math.min(cx, bounds.width - cx) : bounds.width - start.x;
  const maxHeight = fromCentre ? 2 * Math.min(cy, bounds.height - cy) : bounds.height - start.y;
  const sized = withAspect(
    e,
    start,
    clamp(start.width + grow * (e.clientX - start.pointerX), minWidth, maxWidth),
    clamp(start.height + grow * (e.clientY - start.pointerY), minHeight, maxHeight),
    maxHeight,
  );
  if (!fromCentre) return { x: start.x, y: start.y, ...sized };
  return { x: cx - sized.width / 2, y: cy - sized.height / 2, ...sized };
}

/** An arrow key's step, or null for any other key. */
export function arrowStep(key: string, step = KEYBOARD_MOVE_STEP): { dx: number; dy: number } | null {
  switch (key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 };
    case 'ArrowRight':
      return { dx: step, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -step };
    case 'ArrowDown':
      return { dx: 0, dy: step };
    default:
      return null;
  }
}
