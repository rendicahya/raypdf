<script lang="ts">
  import type { Snippet } from 'svelte';
  import { isMultiSelectClick } from '../stores/itemSelection';
  import { tooltip } from '../lib/utils/tooltip';

  // A placed item on a page that can be selected, dragged, resized from its
  // corner handle, nudged with the arrow keys, and removed (its × or
  // Delete). Used for shapes and images; what's drawn inside is the
  // children snippet, sized to the box.

  interface Geometry {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  interface Props {
    /** Set as `data-<kind>` on the element, for the context menu and hit tests. */
    attr: string;
    id: string;
    box: Geometry;
    selected: boolean;
    label: string;
    /** The page's size in canvas pixels, to keep the box on it. */
    bounds: () => { width: number; height: number };
    /** Resize keeping the width-to-height ratio (images). */
    keepAspect?: boolean;
    /** Smallest size the corner handle allows, for both sides together. */
    minSize?: number;
    /** Clickable margin around the box, so a thin line can still be grabbed. */
    pad?: number;
    onSelect: () => void;
    onDeselect: () => void;
    onChange: (geometry: Partial<Geometry>) => void;
    onRemove: () => void;
    /** Double-click, e.g. to open the item's options panel. */
    onDoubleClick?: () => void;
    /** Degrees clockwise about the box's centre; the box itself stays unturned. */
    angle?: number;
    /** Given, the box shows a rotate handle above it while selected. */
    onRotate?: (angle: number | undefined) => void;
    /**
     * Given, the item is a line from corner to corner of its box (flipX /
     * flipY pick the corners, as `PlacedShape`): it's grabbed along the line
     * rather than the whole box, and reshaped by dragging either end.
     */
    line?: { flipX: boolean; flipY: boolean };
    /** A dragged end: the new box and corners, with any turn folded in. */
    onLineChange?: (geometry: Geometry & { flipX: boolean; flipY: boolean; angle: undefined }) => void;
    children: Snippet;
  }

  let {
    attr,
    id,
    box,
    selected,
    label,
    bounds,
    keepAspect = false,
    minSize = 12,
    pad = 0,
    onSelect,
    onDeselect,
    onChange,
    onRemove,
    onDoubleClick,
    angle,
    onRotate,
    line,
    onLineChange,
    children,
  }: Props = $props();

  const KEYBOARD_MOVE_STEP = 10;

  let el: HTMLDivElement;
  let gesture: { kind: 'move' | 'resize'; pointerX: number; pointerY: number; start: Geometry; angle?: number } | null =
    null;

  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

  function onWindowPointerDown(e: PointerEvent) {
    if (!selected) return;
    const target = e.target as Element | null;
    if (el?.contains(target) || target?.closest?.('[data-tool-panel]')) return;
    // Shift-clicking another item starts a group with this one (ItemSelection).
    if (isMultiSelectClick(e)) return;
    onDeselect();
  }

  function begin(e: PointerEvent, kind: 'move' | 'resize') {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect();
    gesture = { kind, pointerX: e.clientX, pointerY: e.clientY, start: { ...box }, angle };
    // A line's box takes no pointer events itself (only the line does), so
    // the line holds the capture; the moves still bubble up to the box.
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  // A line's ends, in the box's own (unturned) coordinates.
  const ends = $derived(
    line
      ? {
          start: [line.flipX ? box.width : 0, line.flipY ? box.height : 0],
          end: [line.flipX ? 0 : box.width, line.flipY ? 0 : box.height],
        }
      : null,
  );

  // The × beside a line's middle, off to the side that's more upward.
  const removeAt = $derived.by(() => {
    if (!ends) return null;
    const dx = ends.end[0] - ends.start[0];
    const dy = ends.end[1] - ends.start[1];
    const length = Math.hypot(dx, dy) || 1;
    let [nx, ny] = [dy / length, -dx / length];
    if (ny > 0 || (ny === 0 && nx < 0)) [nx, ny] = [-nx, -ny];
    return [pad + (ends.start[0] + ends.end[0]) / 2 + nx * 18, pad + (ends.start[1] + ends.end[1]) / 2 + ny * 18];
  });

  const LINE_SNAP_STEP = 15;
  let endGesture: { pointerX: number; pointerY: number; which: 'start' | 'end'; fixed: number[]; moving: number[] } | null =
    null;

  function onEndPointerDown(e: PointerEvent, which: 'start' | 'end') {
    if (e.button !== 0 || !line) return;
    e.stopPropagation();
    onSelect();
    // Both ends as shown on the page, so a turned line's turn is folded in.
    const a = ((angle ?? 0) * Math.PI) / 180;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const onPage = ([x, y]: number[]) => {
      const lx = box.x + x - cx;
      const ly = box.y + y - cy;
      return [cx + lx * Math.cos(a) - ly * Math.sin(a), cy + lx * Math.sin(a) + ly * Math.cos(a)];
    };
    const start = onPage(ends!.start);
    const end = onPage(ends!.end);
    endGesture = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      which,
      fixed: which === 'start' ? end : start,
      moving: which === 'start' ? start : end,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onEndPointerMove(e: PointerEvent) {
    if (!endGesture || !onLineChange) return;
    e.stopPropagation();
    const { fixed, moving, which } = endGesture;
    let x = moving[0] + e.clientX - endGesture.pointerX;
    let y = moving[1] + e.clientY - endGesture.pointerY;
    if (e.shiftKey) {
      // Shift keeps the line at steps of 15° from the other end.
      const step = (LINE_SNAP_STEP * Math.PI) / 180;
      const turn = Math.round(Math.atan2(y - fixed[1], x - fixed[0]) / step) * step;
      const length = Math.hypot(x - fixed[0], y - fixed[1]);
      x = fixed[0] + length * Math.cos(turn);
      y = fixed[1] + length * Math.sin(turn);
    }
    const page = bounds();
    x = clamp(x, 0, page.width);
    y = clamp(y, 0, page.height);
    if (Math.hypot(x - fixed[0], y - fixed[1]) < minSize) return;
    const [sx, sy] = which === 'start' ? [x, y] : fixed;
    const [ex, ey] = which === 'start' ? fixed : [x, y];
    onLineChange({
      x: Math.min(sx, ex),
      y: Math.min(sy, ey),
      width: Math.abs(ex - sx),
      height: Math.abs(ey - sy),
      flipX: sx > ex,
      flipY: sy > ey,
      angle: undefined,
    });
  }

  function onEndPointerUp(e: PointerEvent) {
    if (!endGesture) return;
    endGesture = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!gesture) return;
    const { start } = gesture;
    const dx = e.clientX - gesture.pointerX;
    const dy = e.clientY - gesture.pointerY;
    const page = bounds();
    if (gesture.kind === 'move') {
      onChange({
        x: clamp(start.x + dx, 0, page.width - start.width),
        y: clamp(start.y + dy, 0, page.height - start.height),
      });
      return;
    }
    // A turned box grows along its own sides, from its turned top-left
    // corner, and the page only limits it to the page's own size.
    const a = ((gesture.angle ?? 0) * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const maxWidth = a ? page.width : page.width - start.x;
    const maxHeight = a ? page.height : page.height - start.y;
    let width = clamp(start.width + dx * cos + dy * sin, 0, maxWidth);
    let height = clamp(start.height - dx * sin + dy * cos, 0, maxHeight);
    // Images always keep their proportions; anything else while Ctrl is held.
    if ((keepAspect || e.ctrlKey || e.metaKey) && start.width > 0 && start.height > 0) {
      const aspect = start.width / start.height;
      height = width / aspect;
      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspect;
      }
    }
    if (Math.max(width, height) < minSize) return;
    if (!a) {
      onChange({ width, height });
      return;
    }
    // Keep the turned top-left corner where it is: from the old centre to
    // that corner, then on to the new centre.
    const turn = (x: number, y: number) => [x * cos - y * sin, x * sin + y * cos];
    const [ox, oy] = turn(-start.width / 2, -start.height / 2);
    const [nx, ny] = turn(width / 2, height / 2);
    const cx = start.x + start.width / 2 + ox + nx;
    const cy = start.y + start.height / 2 + oy + ny;
    onChange({ width, height, x: cx - width / 2, y: cy - height / 2 });
  }

  // Turning with the handle above the box: it points from the centre to the
  // pointer, snapping to upright and the quarter turns when close, and to
  // steps of 15° with Shift.
  const ROTATE_SNAP = 5;
  const KEYBOARD_ROTATE_STEP = 15;
  let rotateCentre: { x: number; y: number } | null = null;

  function normalizedAngle(value: number): number | undefined {
    const a = ((Math.round(value) % 360) + 360) % 360;
    return a === 0 ? undefined : a;
  }

  function onRotatePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    // A turned element's bounding box still has the same centre.
    const rect = el.getBoundingClientRect();
    rotateCentre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onRotatePointerMove(e: PointerEvent) {
    if (!rotateCentre || !onRotate) return;
    // 0° is the handle straight above the centre.
    let value = (Math.atan2(e.clientY - rotateCentre.y, e.clientX - rotateCentre.x) * 180) / Math.PI + 90;
    if (e.shiftKey) value = Math.round(value / 15) * 15;
    else {
      const quarter = Math.round(value / 90) * 90;
      if (Math.abs(value - quarter) < ROTATE_SNAP) value = quarter;
    }
    onRotate(normalizedAngle(value));
  }

  function onRotatePointerUp(e: PointerEvent) {
    if (!rotateCentre) return;
    rotateCentre = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function onRotateKeydown(e: KeyboardEvent) {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) return;
    e.preventDefault();
    // Not also a move of the whole box.
    e.stopPropagation();
    const step = e.shiftKey ? 1 : KEYBOARD_ROTATE_STEP;
    onRotate?.(normalizedAngle((angle ?? 0) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? step : -step)));
  }

  function onPointerUp(e: PointerEvent) {
    if (!gesture) return;
    gesture = null;
    const target = e.target as Element;
    if (target.hasPointerCapture?.(e.pointerId)) target.releasePointerCapture(e.pointerId);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      // Not also a shortcut elsewhere (deleting selected pages).
      e.stopPropagation();
      onRemove();
      return;
    }
    const dx = e.key === 'ArrowLeft' ? -KEYBOARD_MOVE_STEP : e.key === 'ArrowRight' ? KEYBOARD_MOVE_STEP : 0;
    const dy = e.key === 'ArrowUp' ? -KEYBOARD_MOVE_STEP : e.key === 'ArrowDown' ? KEYBOARD_MOVE_STEP : 0;
    if (dx === 0 && dy === 0) return;
    e.preventDefault();
    const page = bounds();
    onChange({
      x: clamp(box.x + dx, 0, page.width - box.width),
      y: clamp(box.y + dy, 0, page.height - box.height),
    });
  }
</script>

<!-- Capture phase: other items stop their pointerdown from bubbling. -->
<svelte:window onpointerdowncapture={onWindowPointerDown} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={el}
  {...{ [`data-${attr}`]: id }}
  data-placed-box=""
  role="group"
  tabindex="0"
  aria-label="{label}. Drag to move, {line
    ? 'drag either end to reshape'
    : 'drag the corner handle to resize'}, Delete to remove."
  class="absolute cursor-move touch-none outline-none {line
    ? 'pointer-events-none'
    : selected
      ? 'ring-2 ring-blue-400/70'
      : 'hover:ring-1 hover:ring-blue-300/60'}"
  style:left="{box.x - pad}px"
  style:top="{box.y - pad}px"
  style:width="{box.width + pad * 2}px"
  style:height="{box.height + pad * 2}px"
  style:transform={angle ? `rotate(${angle}deg)` : undefined}
  onpointerdown={(e) => begin(e, 'move')}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onfocus={onSelect}
  ondblclick={(e) => {
    if (!onDoubleClick) return;
    e.stopPropagation();
    onDoubleClick();
  }}
  onkeydown={onKeydown}
>
  <div class="pointer-events-none absolute" style:inset="{pad}px">
    {@render children()}
  </div>

  {#if ends}
    <!-- Only the line itself (with some slack) grabs the pointer, not its whole box. -->
    <svg
      class="pointer-events-none absolute left-0 top-0 overflow-visible"
      width={box.width + pad * 2}
      height={box.height + pad * 2}
      aria-hidden="true"
    >
      <line
        x1={pad + ends.start[0]}
        y1={pad + ends.start[1]}
        x2={pad + ends.end[0]}
        y2={pad + ends.end[1]}
        stroke-width="14"
        stroke-linecap="round"
        pointer-events="stroke"
        class="cursor-move {selected ? 'stroke-blue-400/25' : 'stroke-transparent hover:stroke-blue-300/25'}"
      />
    </svg>
  {/if}

  {#if selected && ends}
    {#each [['start', ends.start], ['end', ends.end]] as const as [which, [x, y]]}
      <div
        role="button"
        tabindex="-1"
        aria-label={which === 'start' ? 'Move start point' : 'Move end point'}
        use:tooltip={'Drag to move this end (Shift snaps to 15°)'}
        class="pointer-events-auto absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-crosshair touch-none
          rounded-full border border-white bg-blue-500 shadow"
        style:left="{pad + x}px"
        style:top="{pad + y}px"
        onpointerdown={(e) => onEndPointerDown(e, which)}
        onpointermove={onEndPointerMove}
        onpointerup={onEndPointerUp}
        onpointercancel={onEndPointerUp}
      ></div>
    {/each}

    <button
      type="button"
      aria-label="Remove"
      class="pointer-events-auto absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 touch-none items-center
        justify-center rounded-full border border-white bg-red-500 text-white shadow transition-colors hover:bg-red-600"
      style:left="{removeAt![0]}px"
      style:top="{removeAt![1]}px"
      onpointerdown={(e) => e.stopPropagation()}
      onclick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3 w-3">
        <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  {:else if selected}
    <div
      role="button"
      tabindex="-1"
      aria-label="Resize"
      class="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-se-resize touch-none rounded-full border border-white
        bg-blue-500 shadow"
      onpointerdown={(e) => begin(e, 'resize')}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
    ></div>

    {#if onRotate}
      <div class="pointer-events-none absolute -top-5 left-1/2 h-5 w-px -translate-x-1/2 bg-blue-500"></div>
      <div
        role="slider"
        tabindex="0"
        aria-label="Rotate"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={angle ?? 0}
        aria-valuetext="{angle ?? 0} degrees"
        use:tooltip={'Rotate (drag; Shift snaps to 15°). Double-click to straighten'}
        class="absolute -top-7 left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab touch-none rounded-full border
          border-white bg-blue-500 shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
        onpointerdown={onRotatePointerDown}
        onpointermove={onRotatePointerMove}
        onpointerup={onRotatePointerUp}
        onpointercancel={onRotatePointerUp}
        ondblclick={(e) => {
          e.stopPropagation();
          onRotate(undefined);
        }}
        onkeydown={onRotateKeydown}
      ></div>
    {/if}

    <button
      type="button"
      aria-label="Remove"
      class="absolute -right-1.5 -top-1.5 flex h-5 w-5 touch-none items-center justify-center rounded-full border
        border-white bg-red-500 text-white shadow transition-colors hover:bg-red-600"
      onpointerdown={(e) => e.stopPropagation()}
      onclick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3 w-3">
        <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  {/if}
</div>
