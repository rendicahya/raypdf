<script lang="ts">
  import type { Snippet } from 'svelte';

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
    children,
  }: Props = $props();

  const KEYBOARD_MOVE_STEP = 10;

  let el: HTMLDivElement;
  let gesture: { kind: 'move' | 'resize'; pointerX: number; pointerY: number; start: Geometry } | null = null;

  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

  function onWindowPointerDown(e: PointerEvent) {
    if (!selected) return;
    const target = e.target as Element | null;
    if (el?.contains(target) || target?.closest?.('[data-tool-panel]')) return;
    onDeselect();
  }

  function begin(e: PointerEvent, kind: 'move' | 'resize') {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect();
    gesture = { kind, pointerX: e.clientX, pointerY: e.clientY, start: { ...box } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
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
    let width = clamp(start.width + dx, 0, page.width - start.x);
    let height = clamp(start.height + dy, 0, page.height - start.y);
    if (keepAspect && start.width > 0 && start.height > 0) {
      const aspect = start.width / start.height;
      height = width / aspect;
      if (height > page.height - start.y) {
        height = page.height - start.y;
        width = height * aspect;
      }
    }
    if (Math.max(width, height) < minSize) return;
    onChange({ width, height });
  }

  function onPointerUp(e: PointerEvent) {
    if (!gesture) return;
    gesture = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
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
  aria-label="{label}. Drag to move, drag the corner handle to resize, Delete to remove."
  class="absolute cursor-move touch-none outline-none {selected
    ? 'ring-2 ring-blue-400/70'
    : 'hover:ring-1 hover:ring-blue-300/60'}"
  style:left="{box.x - pad}px"
  style:top="{box.y - pad}px"
  style:width="{box.width + pad * 2}px"
  style:height="{box.height + pad * 2}px"
  onpointerdown={(e) => begin(e, 'move')}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onfocus={onSelect}
  onkeydown={onKeydown}
>
  <div class="pointer-events-none absolute" style:inset="{pad}px">
    {@render children()}
  </div>

  {#if selected}
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
