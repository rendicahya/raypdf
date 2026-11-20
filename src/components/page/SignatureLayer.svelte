<script lang="ts">
  import { editorStore, type PlacedSignature } from '../../stores/editor';
  import { signatureStore, resolveSignature } from '../../stores/signature';
  import {
    watermarkText,
    includeTimestamp,
    watermarkPosition,
    watermarkFontScale,
    watermarkColor,
    watermarkOpacity,
    type WatermarkPosition,
  } from '../../stores/watermark';
  import { buildWatermarkLines } from '../../lib/watermark/visible';
  import { tooltip } from '../../lib/utils/tooltip';
  import { arrowStep, clamp } from '../../lib/utils/boxGeometry';
  import { getPageContext } from './pageContext.svelte';
  import {
    editSignature,
    normalizedAngle,
    rememberPlacement,
    resizedFromCorner,
    rotateSignatureBy,
  } from './signatureActions';

  // The signatures placed on one page, each with its visible watermark
  // previewed over it: moved by dragging or the arrow keys, resized by the
  // corner handle (always keeping the aspect ratio; Shift grows from the
  // centre), turned by the handle above it, removed with the × or Delete, and
  // opened in the signature panel by a double-click. The handles and × show
  // only while it's selected. Every change is remembered for "Use last
  // position". Placing them is PDFViewer's (a drop, or click-to-place).

  interface Props {
    signatures: PlacedSignature[];
  }

  let { signatures }: Props = $props();

  const page = getPageContext();
  const selection = page.selection;

  // Live preview of the watermark text, kept in sync with the export logic in lib/watermark/visible.ts.
  const previewLines = $derived(buildWatermarkLines({ customText: $watermarkText, includeTimestamp: $includeTimestamp }));

  function positionToFlex(position: WatermarkPosition) {
    const [v, h] = position.split('-') as [string, string | undefined];
    const justifyContent = v === 'top' ? 'flex-start' : v === 'bottom' ? 'flex-end' : 'center';
    const alignItems = h === 'left' ? 'flex-start' : h === 'right' ? 'flex-end' : 'center';
    const textAlign = h === 'left' ? 'left' : h === 'right' ? 'right' : 'center';
    return { justifyContent, alignItems, textAlign };
  }

  const previewAlign = $derived(positionToFlex($watermarkPosition));

  // Looked up fresh by id on every step, since the store emits a new object on every pointermove.
  const sigById = (id: string) => signatures.find((s) => s.id === id);

  function remember(id: string) {
    const sig = sigById(id);
    if (sig) rememberPlacement(sig, page.canvasRect());
  }

  let movingId: string | null = null;
  let moveOffset = { x: 0, y: 0 };

  function onPointerDown(e: PointerEvent, id: string) {
    e.stopPropagation();
    selection.signatureId = id;
    movingId = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    // From the box's own corner, not the element's on-screen bounds, which grow when it's turned.
    const sig = sigById(id);
    const rect = page.canvasRect();
    moveOffset = sig ? { x: e.clientX - rect.left - sig.x, y: e.clientY - rect.top - sig.y } : { x: 0, y: 0 };
  }

  function onPointerMove(e: PointerEvent, id: string) {
    if (movingId !== id) return;
    const sig = sigById(id);
    if (!sig) return;
    const rect = page.canvasRect();
    const x = clamp(e.clientX - rect.left - moveOffset.x, 0, rect.width - sig.width);
    const y = clamp(e.clientY - rect.top - moveOffset.y, 0, rect.height - sig.height);
    editorStore.updateSignature(id, { x, y });
  }

  function onPointerUp() {
    if (movingId) remember(movingId);
    movingId = null;
  }

  function remove(id: string) {
    editorStore.removeSignature(id);
    if (selection.signatureId === id) selection.signatureId = null;
  }

  // Arrow keys nudge a signature, so keyboard users can reposition it without dragging.
  function onKeydown(e: KeyboardEvent, id: string) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(id);
      return;
    }
    const step = arrowStep(e.key);
    if (!step) return;
    e.preventDefault();
    const sig = sigById(id);
    if (!sig) return;
    const rect = page.canvasRect();
    const x = clamp(sig.x + step.dx, 0, rect.width - sig.width);
    const y = clamp(sig.y + step.dy, 0, rect.height - sig.height);
    editorStore.updateSignature(id, { x, y });
    rememberPlacement({ ...sig, x, y }, rect);
  }

  // Resize by the corner handle, always keeping the signature's aspect ratio.
  const KEYBOARD_RESIZE_STEP = 10;
  let resizingId: string | null = null;
  let resizeStart: (PlacedSignature & { pointerX: number; pointerY: number }) | null = null;

  function onResizeKeydown(e: KeyboardEvent, id: string) {
    const step = arrowStep(e.key);
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const sig = sigById(id);
    if (!sig) return;
    const rect = page.canvasRect();
    const grow = e.key === 'ArrowUp' || e.key === 'ArrowRight';
    const resized = resizedFromCorner(sig, sig.width + (grow ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP), rect);
    editorStore.updateSignature(id, resized);
    rememberPlacement({ ...sig, ...resized }, rect);
  }

  function onResizePointerDown(e: PointerEvent, id: string) {
    e.stopPropagation();
    const sig = sigById(id);
    if (!sig) return;
    resizingId = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeStart = { pointerX: e.clientX, pointerY: e.clientY, ...sig };
  }

  function onResizePointerMove(e: PointerEvent, id: string) {
    if (resizingId !== id || !resizeStart) return;
    // How far the pointer moved along the signature's own width, turned with it.
    const a = ((resizeStart.angle ?? 0) * Math.PI) / 180;
    const along = (e.clientX - resizeStart.pointerX) * Math.cos(a) + (e.clientY - resizeStart.pointerY) * Math.sin(a);
    const grow = e.shiftKey ? 2 : 1;
    editorStore.updateSignature(
      id,
      resizedFromCorner(resizeStart, resizeStart.width + grow * along, page.canvasRect(), e.shiftKey),
    );
  }

  function onResizePointerUp(e: PointerEvent) {
    if (resizingId) remember(resizingId);
    resizingId = null;
    resizeStart = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  // Turn by the handle above the signature: it points from the centre to the
  // pointer, snapping to upright and the quarter turns when close, and to
  // steps of 15° with Shift.
  const ROTATE_SNAP = 5;
  const KEYBOARD_ROTATE_STEP = 15;
  let rotatingId: string | null = null;
  let rotateCentre = { x: 0, y: 0 };

  function onRotatePointerDown(e: PointerEvent, id: string) {
    e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).closest('[data-placed-signature]')?.getBoundingClientRect();
    if (!box) return;
    rotatingId = id;
    rotateCentre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onRotatePointerMove(e: PointerEvent, id: string) {
    if (rotatingId !== id) return;
    // 0° is the handle straight above the centre.
    let angle = (Math.atan2(e.clientY - rotateCentre.y, e.clientX - rotateCentre.x) * 180) / Math.PI + 90;
    if (e.shiftKey) angle = Math.round(angle / 15) * 15;
    else {
      const quarter = Math.round(angle / 90) * 90;
      if (Math.abs(angle - quarter) < ROTATE_SNAP) angle = quarter;
    }
    editorStore.updateSignature(id, { angle: normalizedAngle(angle) });
  }

  function onRotatePointerUp(e: PointerEvent) {
    if (rotatingId) remember(rotatingId);
    rotatingId = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function rotateBy(id: string, delta: number) {
    const sig = sigById(id);
    if (sig) rotateSignatureBy(sig, delta, page.canvasRect());
  }

  function onRotateKeydown(e: KeyboardEvent, id: string) {
    if (!arrowStep(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 1 : KEYBOARD_ROTATE_STEP;
    rotateBy(id, e.key === 'ArrowRight' || e.key === 'ArrowDown' ? step : -step);
  }
</script>

{#each signatures as sig (sig.id)}
  {@const isSelected = selection.signatureId === sig.id}
  {@const image = resolveSignature($signatureStore, sig.signatureId)}
  {#if image}
    <!-- role="group" is the closest ARIA fit for a movable/resizable object
         (it groups the resize handle and remove button), but that role is
         classified as non-interactive by Svelte's a11y check even though
         this element is deliberately focusable and arrow-key operable. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      data-placed-signature={sig.id}
      role="group"
      tabindex="0"
      aria-label="Placed signature. Use arrow keys to move, drag the corner handle to resize and the top handle to rotate."
      class="absolute cursor-move touch-none {isSelected ? 'ring-2 ring-blue-400/70 bg-blue-100/10' : ''}"
      style:left="{sig.x}px"
      style:top="{sig.y}px"
      style:width="{sig.width}px"
      style:height="{sig.height}px"
      style:transform={sig.angle ? `rotate(${sig.angle}deg)` : undefined}
      onpointerdown={(e) => onPointerDown(e, sig.id)}
      onpointermove={(e) => onPointerMove(e, sig.id)}
      onpointerup={onPointerUp}
      onfocus={() => (selection.signatureId = sig.id)}
      onkeydown={(e) => onKeydown(e, sig.id)}
      ondblclick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'IMG') {
          editSignature(sigById(sig.id), sig.id, selection);
        }
      }}
    >
      <img src={image.previewUrl} alt="Placed signature" draggable="false" class="h-full w-full select-none object-contain" />

      {#if previewLines.length > 0}
        <div
          class="pointer-events-none absolute inset-0 flex select-none flex-col overflow-hidden leading-tight"
          style:font-size="{sig.height * $watermarkFontScale}px"
          style:color={$watermarkColor}
          style:opacity={$watermarkOpacity}
          style:padding="{sig.height * 0.06}px"
          style:justify-content={previewAlign.justifyContent}
          style:align-items={previewAlign.alignItems}
          style:text-align={previewAlign.textAlign}
        >
          {#each previewLines as line}
            <div>{line}</div>
          {/each}
        </div>
      {/if}

      {#if isSelected}
        <div
          role="button"
          tabindex="0"
          aria-label="Resize signature"
          data-resize-handle
          title="Resize signature (drag, or use arrow keys)"
          class="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-se-resize touch-none rounded-full
            border border-white bg-blue-500 shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
          onpointerdown={(e) => onResizePointerDown(e, sig.id)}
          onpointermove={(e) => onResizePointerMove(e, sig.id)}
          onpointerup={onResizePointerUp}
          onkeydown={(e) => onResizeKeydown(e, sig.id)}
        ></div>

        <div class="pointer-events-none absolute -top-5 left-1/2 h-5 w-px -translate-x-1/2 bg-blue-500"></div>
        <div
          role="slider"
          tabindex="0"
          aria-label="Rotate signature"
          aria-valuemin={0}
          aria-valuemax={359}
          aria-valuenow={sig.angle ?? 0}
          aria-valuetext="{sig.angle ?? 0} degrees"
          use:tooltip={'Rotate (drag; Shift snaps to 15°). Double-click to straighten'}
          class="absolute -top-7 left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab touch-none rounded-full
            border border-white bg-blue-500 shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
          onpointerdown={(e) => onRotatePointerDown(e, sig.id)}
          onpointermove={(e) => onRotatePointerMove(e, sig.id)}
          onpointerup={onRotatePointerUp}
          ondblclick={() => rotateBy(sig.id, -(sig.angle ?? 0))}
          onkeydown={(e) => onRotateKeydown(e, sig.id)}
        ></div>

        <button
          type="button"
          aria-label="Remove placed signature"
          title="Remove placed signature"
          class="absolute -right-1.5 -top-1.5 flex h-5 w-5 touch-none items-center justify-center rounded-full
            border border-white bg-red-500 text-white shadow transition-colors hover:bg-red-600"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => {
            e.stopPropagation();
            remove(sig.id);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3 w-3">
            <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      {/if}
    </div>
  {/if}
{/each}
