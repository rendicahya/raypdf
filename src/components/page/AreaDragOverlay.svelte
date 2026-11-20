<script module lang="ts">
  /** An area of the page as fractions (0 to 1) of the page as shown. */
  export interface PageArea {
    x: number;
    y: number;
    width: number;
    height: number;
  }
</script>

<script lang="ts">
  // Covers a page (and every overlay on it) so a drag over it marks out an
  // area, never moves or resizes something below: Screenshot and Recognize
  // text in an area. Shown only while its tool is on, so each drag starts fresh.

  interface Props {
    /** Border and fill of the dashed frame while dragging. */
    frameClass: string;
    /** Ignores new drags, e.g. while a capture is running. */
    disabled?: boolean;
    /** Dims the page while something runs on it. */
    busy?: boolean;
    /** The area dragged, or null for a click or a drag too small to be deliberate. */
    onDone: (area: PageArea | null) => void;
  }

  let { frameClass, disabled = false, busy = false, onDone }: Props = $props();

  const MIN_SIZE = 8;
  let el: HTMLDivElement;
  let box: { x: number; y: number; width: number; height: number } | null = $state(null);
  let start = { x: 0, y: 0 };

  function point(e: PointerEvent) {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.min(Math.max(e.clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(e.clientY - rect.top, 0), rect.height),
    };
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || disabled) return;
    e.stopPropagation();
    start = point(e);
    box = { ...start, width: 0, height: 0 };
    el.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!box) return;
    const { x, y } = point(e);
    box = {
      x: Math.min(x, start.x),
      y: Math.min(y, start.y),
      width: Math.abs(x - start.x),
      height: Math.abs(y - start.y),
    };
  }

  function onPointerUp(e: PointerEvent) {
    const done = box;
    box = null;
    if (!done) return;
    el.releasePointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    onDone(
      done.width >= MIN_SIZE && done.height >= MIN_SIZE
        ? {
            x: done.x / rect.width,
            y: done.y / rect.height,
            width: done.width / rect.width,
            height: done.height / rect.height,
          }
        : null,
    );
  }
</script>

<div
  bind:this={el}
  role="presentation"
  class="absolute inset-0 z-[60] cursor-crosshair touch-none"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={() => (box = null)}
>
  {#if box && (box.width > 0 || box.height > 0)}
    <div
      class="pointer-events-none absolute border-2 border-dashed {frameClass}"
      style:left="{box.x}px"
      style:top="{box.y}px"
      style:width="{box.width}px"
      style:height="{box.height}px"
    ></div>
  {/if}
  {#if busy}
    <div class="pointer-events-none absolute inset-0 animate-pulse bg-white/30 dark:bg-black/20"></div>
  {/if}
</div>
