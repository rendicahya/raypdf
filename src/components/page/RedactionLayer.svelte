<script lang="ts">
  import { editorStore, type RedactionBox } from '../../stores/editor';
  import { getPageContext } from './pageContext.svelte';
  import { arrowStep, clamp, resizedBox } from '../../lib/utils/boxGeometry';

  // The redaction boxes on one page: black, moved by dragging or the arrow
  // keys, resized by the corner handle (Ctrl keeps the proportions, Shift
  // grows from the centre), removed with the × or Delete. Drawing new ones is
  // PDFViewer's (a drag on the canvas while Redact is on).

  interface Props {
    boxes: RedactionBox[];
  }

  let { boxes }: Props = $props();

  const page = getPageContext();
  const selection = page.selection;
  const MIN_SIZE = 12;

  // Looked up fresh by id on every step (rather than trusting a closure
  // snapshot), since the store emits a new object on every pointermove.
  const boxById = (id: string) => boxes.find((b) => b.id === id);

  let movingId: string | null = null;
  let moveOffset = { x: 0, y: 0 };

  function onPointerDown(e: PointerEvent, id: string) {
    e.stopPropagation();
    selection.redactionId = id;
    movingId = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const boxRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    moveOffset = { x: e.clientX - boxRect.left, y: e.clientY - boxRect.top };
  }

  function onPointerMove(e: PointerEvent, id: string) {
    if (movingId !== id) return;
    const box = boxById(id);
    if (!box) return;
    const rect = page.canvasRect();
    const x = clamp(e.clientX - rect.left - moveOffset.x, 0, rect.width - box.width);
    const y = clamp(e.clientY - rect.top - moveOffset.y, 0, rect.height - box.height);
    editorStore.updateRedaction(id, { x, y });
  }

  let resizingId: string | null = null;
  let resizeStart: (RedactionBox & { pointerX: number; pointerY: number }) | null = null;

  function onResizePointerDown(e: PointerEvent, id: string) {
    e.stopPropagation();
    const box = boxById(id);
    if (!box) return;
    resizingId = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeStart = { pointerX: e.clientX, pointerY: e.clientY, ...box };
  }

  function onResizePointerMove(e: PointerEvent, id: string) {
    if (resizingId !== id || !resizeStart) return;
    editorStore.updateRedaction(id, resizedBox(e, resizeStart, MIN_SIZE, MIN_SIZE, page.canvasRect()));
  }

  function onResizePointerUp(e: PointerEvent) {
    resizingId = null;
    resizeStart = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function remove(id: string) {
    editorStore.removeRedaction(id);
    if (selection.redactionId === id) selection.redactionId = null;
  }

  function onKeydown(e: KeyboardEvent, id: string) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(id);
      return;
    }
    const step = arrowStep(e.key);
    if (!step) return;
    e.preventDefault();
    const box = boxById(id);
    if (!box) return;
    const rect = page.canvasRect();
    editorStore.updateRedaction(id, {
      x: clamp(box.x + step.dx, 0, rect.width - box.width),
      y: clamp(box.y + step.dy, 0, rect.height - box.height),
    });
  }
</script>

{#each boxes as box (box.id)}
  {@const isSelected = selection.redactionId === box.id}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    data-redaction={box.id}
    role="group"
    tabindex="0"
    aria-label="Redacted area, permanently removed on export. Use arrow keys to move, Delete to remove."
    class="absolute cursor-move touch-none bg-black {isSelected ? 'ring-2 ring-blue-400 ring-offset-1' : ''}"
    style:left="{box.x}px"
    style:top="{box.y}px"
    style:width="{box.width}px"
    style:height="{box.height}px"
    onpointerdown={(e) => onPointerDown(e, box.id)}
    onpointermove={(e) => onPointerMove(e, box.id)}
    onpointerup={() => (movingId = null)}
    onfocus={() => (selection.redactionId = box.id)}
    onkeydown={(e) => onKeydown(e, box.id)}
  >
    {#if isSelected}
      <div
        role="button"
        tabindex="0"
        aria-label="Resize redacted area"
        data-resize-handle
        title="Resize (drag, or use arrow keys)"
        class="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-se-resize touch-none rounded-full
          border border-white bg-blue-500 shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
        onpointerdown={(e) => onResizePointerDown(e, box.id)}
        onpointermove={(e) => onResizePointerMove(e, box.id)}
        onpointerup={onResizePointerUp}
      ></div>

      <button
        type="button"
        aria-label="Remove redacted area"
        title="Remove redacted area"
        class="absolute -right-1.5 -top-1.5 flex h-5 w-5 touch-none items-center justify-center rounded-full
          border border-white bg-red-500 text-white shadow transition-colors hover:bg-red-600"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={(e) => {
          e.stopPropagation();
          remove(box.id);
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3 w-3">
          <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    {/if}
  </div>
{/each}
