<script lang="ts">
  import { editorStore, type PlacedText } from '../../stores/editor';
  import {
    textToolMode,
    selectedTextId,
    FONT_FAMILY_CSS,
    SCRIPT_SCALE,
    SCRIPT_SHIFT,
    textDecoration,
  } from '../../stores/textTool';
  import { openTextTool } from '../../stores/toolPanel';
  import { getPageContext } from './pageContext.svelte';
  import { arrowStep, clamp, resizedBox } from '../../lib/utils/boxGeometry';

  // The text boxes on one page: typed into directly (textEditing.svelte.ts),
  // moved by dragging or the arrow keys, resized by the corner handle (a
  // plain rectangle, like a redaction box), removed with the × or Delete.
  // TextOptions in the tool panel restyles the box in `selectedTextId`; a new
  // style field is drawn here, in screenshot.ts, and in textRender.ts alike.
  // Adding them is PDFViewer's (a click with Add Text, or the page menu).

  interface Props {
    texts: PlacedText[];
  }

  let { texts }: Props = $props();

  const page = getPageContext();
  const selection = page.selection;
  const editing = page.textEditing;
  const MIN_WIDTH = 40;
  const MIN_HEIGHT = 20;

  // Looked up fresh by id on every step, since the store emits a new object on every pointermove.
  const textById = (id: string) => texts.find((t) => t.id === id);

  function autofocusTextarea(node: HTMLTextAreaElement) {
    node.focus();
    node.select();
  }

  let movingId: string | null = null;
  let moveOffset = { x: 0, y: 0 };

  function onPointerDown(e: PointerEvent, id: string) {
    if (selection.editingTextId === id) return;
    e.stopPropagation();
    $selectedTextId = id;
    movingId = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const boxRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    moveOffset = { x: e.clientX - boxRect.left, y: e.clientY - boxRect.top };
  }

  function onPointerMove(e: PointerEvent, id: string) {
    if (movingId !== id) return;
    const t = textById(id);
    if (!t) return;
    const rect = page.canvasRect();
    const x = clamp(e.clientX - rect.left - moveOffset.x, 0, rect.width - t.width);
    const y = clamp(e.clientY - rect.top - moveOffset.y, 0, rect.height - t.height);
    editorStore.updateText(id, { x, y });
  }

  let resizingId: string | null = null;
  let resizeStart: (PlacedText & { pointerX: number; pointerY: number }) | null = null;

  function onResizePointerDown(e: PointerEvent, id: string) {
    e.stopPropagation();
    const t = textById(id);
    if (!t) return;
    resizingId = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeStart = { pointerX: e.clientX, pointerY: e.clientY, ...t };
  }

  function onResizePointerMove(e: PointerEvent, id: string) {
    if (resizingId !== id || !resizeStart) return;
    editorStore.updateText(id, resizedBox(e, resizeStart, MIN_WIDTH, MIN_HEIGHT, page.canvasRect()));
  }

  function onResizePointerUp(e: PointerEvent) {
    resizingId = null;
    resizeStart = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function remove(id: string) {
    editorStore.removeText(id);
    if ($selectedTextId === id) $selectedTextId = null;
  }

  function onKeydown(e: KeyboardEvent, id: string) {
    // Only keys pressed on the box itself: the text being typed inside it
    // needs Backspace, Delete, and the arrows for its own text.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(id);
      return;
    }
    const step = arrowStep(e.key);
    if (!step) return;
    e.preventDefault();
    const t = textById(id);
    if (!t) return;
    const rect = page.canvasRect();
    editorStore.updateText(id, {
      x: clamp(t.x + step.dx, 0, rect.width - t.width),
      y: clamp(t.y + step.dy, 0, rect.height - t.height),
    });
  }
</script>

{#each texts as t (t.id)}
  {@const isSelected = $selectedTextId === t.id}
  {@const isEditing = selection.editingTextId === t.id}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    data-placed-text={t.id}
    role="group"
    tabindex="0"
    aria-label="Text box. Double-click to edit, drag to move, drag the corner handle to resize."
    class="absolute touch-none {isEditing ? '' : 'cursor-move'} {isSelected
      ? 'ring-2 ring-blue-400/70'
      : 'hover:ring-1 hover:ring-blue-300/50'}"
    style:left="{t.x}px"
    style:top="{t.y}px"
    style:width="{t.width}px"
    style:height="{t.height}px"
    onpointerdown={(e) => onPointerDown(e, t.id)}
    onpointermove={(e) => onPointerMove(e, t.id)}
    onpointerup={() => (movingId = null)}
    ondblclick={(e) => {
      e.stopPropagation();
      $selectedTextId = t.id;
      openTextTool();
      editing.start(t.id, t.text);
    }}
    onfocus={() => ($selectedTextId = t.id)}
    onkeydown={(e) => onKeydown(e, t.id)}
  >
    {#if isEditing}
      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        use:autofocusTextarea
        bind:value={editing.value}
        onpointerdown={(e) => e.stopPropagation()}
        onblur={() => editing.commit(t.id)}
        onkeydown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          // Escape attaches whatever's typed (same rule as clicking away)
          // and leaves Add Text mode entirely, rather than staying active
          // for another box: Escape's usual meaning of "I'm done".
          editing.commit(t.id);
          textToolMode.set(false);
        }}
        class="h-full w-full resize-none border border-dashed border-blue-400 bg-white/70 p-0
          outline-none"
        style:font-family={FONT_FAMILY_CSS[t.fontFamily]}
        style:font-size="{t.script === 'normal' ? t.fontSize : t.fontSize * SCRIPT_SCALE}px"
        style:font-weight={t.bold ? 700 : 400}
        style:font-style={t.italic ? 'italic' : 'normal'}
        style:text-decoration-line={textDecoration(t)}
        style:color={t.color}
        style:letter-spacing="{t.letterSpacing}px"
        style:word-spacing="{t.wordSpacing}px"
        style:line-height={t.lineHeight}
        style:text-align={t.align}
      ></textarea>
    {:else}
      <!-- The span carries superscript/subscript: smaller and shifted
           within lines that keep the full font size's height. -->
      <div
        class="h-full w-full select-none overflow-hidden whitespace-pre-wrap break-words"
        style:font-family={FONT_FAMILY_CSS[t.fontFamily]}
        style:font-size="{t.fontSize}px"
        style:font-weight={t.bold ? 700 : 400}
        style:font-style={t.italic ? 'italic' : 'normal'}
        style:color={t.color}
        style:background-color={t.background}
        style:opacity={t.opacity}
        style:letter-spacing="{t.letterSpacing}px"
        style:word-spacing="{t.wordSpacing}px"
        style:line-height={t.lineHeight}
        style:text-align={t.align}
      ><span
          class="relative"
          style:font-size={t.script === 'normal' ? null : `${SCRIPT_SCALE}em`}
          style:top="{SCRIPT_SHIFT[t.script] * t.fontSize}px"
          style:text-decoration-line={textDecoration(t)}>{t.text}</span
        ></div>
    {/if}

    {#if isSelected}
      <div
        role="button"
        tabindex="0"
        aria-label="Resize text box"
        data-resize-handle
        title="Resize (drag the handle)"
        class="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-se-resize touch-none rounded-full
          border border-white bg-blue-500 shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
        onpointerdown={(e) => onResizePointerDown(e, t.id)}
        onpointermove={(e) => onResizePointerMove(e, t.id)}
        onpointerup={onResizePointerUp}
      ></div>

      <button
        type="button"
        aria-label="Remove text box"
        title="Remove text box"
        class="absolute -right-1.5 -top-1.5 flex h-5 w-5 touch-none items-center justify-center rounded-full
          border border-white bg-red-500 text-white shadow transition-colors hover:bg-red-600"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={(e) => {
          e.stopPropagation();
          remove(t.id);
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3 w-3">
          <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    {/if}
  </div>
{/each}
