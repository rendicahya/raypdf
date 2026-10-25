<script lang="ts">
  import { cropFrame, type CropFrame } from '../stores/cropTool';

  // The Crop tool's layer over one page: covers the page (and everything on
  // it) so a drag always frames the area to keep. Dragging outside the frame
  // draws a new one; dragging inside moves it; its edges and corners resize it.

  let { pageNumber }: { pageNumber: number } = $props();

  let el: HTMLDivElement;
  let width = $state(0);
  let height = $state(0);

  /** Smallest frame, in screen pixels. */
  const MIN_SIZE = 16;

  type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
  const HANDLES: { edge: Edge; cursor: string; style: string }[] = [
    { edge: 'nw', cursor: 'nwse-resize', style: 'left:-6px;top:-6px' },
    { edge: 'n', cursor: 'ns-resize', style: 'left:calc(50% - 6px);top:-6px' },
    { edge: 'ne', cursor: 'nesw-resize', style: 'right:-6px;top:-6px' },
    { edge: 'e', cursor: 'ew-resize', style: 'right:-6px;top:calc(50% - 6px)' },
    { edge: 'se', cursor: 'nwse-resize', style: 'right:-6px;bottom:-6px' },
    { edge: 's', cursor: 'ns-resize', style: 'left:calc(50% - 6px);bottom:-6px' },
    { edge: 'sw', cursor: 'nesw-resize', style: 'left:-6px;bottom:-6px' },
    { edge: 'w', cursor: 'ew-resize', style: 'left:-6px;top:calc(50% - 6px)' },
  ];

  // The frame on this page, in pixels.
  const frame = $derived.by(() => {
    const f = $cropFrame;
    if (!f || f.page !== pageNumber) return null;
    return { x: f.x * width, y: f.y * height, width: f.width * width, height: f.height * height };
  });

  type Box = { x: number; y: number; width: number; height: number };
  let gesture: { kind: 'draw' | 'move' | Edge; startX: number; startY: number; start: Box } | null = null;

  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

  function pointer(e: PointerEvent) {
    const rect = el.getBoundingClientRect();
    return { x: clamp(e.clientX - rect.left, 0, rect.width), y: clamp(e.clientY - rect.top, 0, rect.height) };
  }

  function store(box: Box) {
    if (width === 0 || height === 0) return;
    const next: CropFrame = {
      page: pageNumber,
      x: box.x / width,
      y: box.y / height,
      width: box.width / width,
      height: box.height / height,
    };
    cropFrame.set(next);
  }

  function begin(e: PointerEvent, kind: 'draw' | 'move' | Edge) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = pointer(e);
    const start = kind === 'draw' || !frame ? { x: p.x, y: p.y, width: 0, height: 0 } : { ...frame };
    gesture = { kind, startX: p.x, startY: p.y, start };
    el.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!gesture) return;
    const p = pointer(e);
    const { kind, start } = gesture;
    if (kind === 'draw') {
      const box = {
        x: Math.min(p.x, gesture.startX),
        y: Math.min(p.y, gesture.startY),
        width: Math.abs(p.x - gesture.startX),
        height: Math.abs(p.y - gesture.startY),
      };
      if (box.width >= 2 || box.height >= 2) store(box);
      return;
    }
    const dx = p.x - gesture.startX;
    const dy = p.y - gesture.startY;
    if (kind === 'move') {
      store({
        ...start,
        x: clamp(start.x + dx, 0, width - start.width),
        y: clamp(start.y + dy, 0, height - start.height),
      });
      return;
    }
    let left = start.x;
    let top = start.y;
    let right = start.x + start.width;
    let bottom = start.y + start.height;
    if (kind.includes('w')) left = clamp(left + dx, 0, right - MIN_SIZE);
    if (kind.includes('e')) right = clamp(right + dx, left + MIN_SIZE, width);
    if (kind.includes('n')) top = clamp(top + dy, 0, bottom - MIN_SIZE);
    if (kind.includes('s')) bottom = clamp(bottom + dy, top + MIN_SIZE, height);
    store({ x: left, y: top, width: right - left, height: bottom - top });
  }

  function onPointerUp(e: PointerEvent) {
    if (!gesture) return;
    const drew = gesture.kind === 'draw';
    gesture = null;
    el.releasePointerCapture(e.pointerId);
    // A click, or a drag too small to keep, leaves no frame.
    const f = $cropFrame;
    if (drew && f?.page === pageNumber && (f.width * width < MIN_SIZE || f.height * height < MIN_SIZE)) {
      cropFrame.set(null);
    }
  }
</script>

<div
  bind:this={el}
  bind:clientWidth={width}
  bind:clientHeight={height}
  role="presentation"
  class="absolute inset-0 z-[60] cursor-crosshair touch-none overflow-hidden rounded-lg"
  onpointerdown={(e) => begin(e, 'draw')}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
>
  {#if frame}
    <!-- The page outside the frame is dimmed by the frame's own shadow. -->
    <div
      role="presentation"
      class="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] outline
        outline-1 outline-black/40"
      style:left="{frame.x}px"
      style:top="{frame.y}px"
      style:width="{frame.width}px"
      style:height="{frame.height}px"
      onpointerdown={(e) => begin(e, 'move')}
    >
      <!-- Thirds, as a guide. -->
      <div class="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
        {#each Array(9) as _, i (i)}
          <div class="border-white/40" class:border-r={i % 3 !== 2} class:border-b={i < 6}></div>
        {/each}
      </div>
      {#each HANDLES as h (h.edge)}
        <div
          role="presentation"
          class="absolute h-3 w-3 rounded-sm border border-neutral-500 bg-white shadow"
          style="{h.style};cursor:{h.cursor}"
          onpointerdown={(e) => begin(e, h.edge)}
        ></div>
      {/each}
    </div>
  {/if}
</div>
