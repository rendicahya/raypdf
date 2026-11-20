<script lang="ts">
  import { editorStore, type PlacedComment } from '../../stores/editor';
  import { commentToolMode } from '../../stores/commentTool';
  import { getPageContext } from './pageContext.svelte';
  import { arrowStep, clamp } from '../../lib/utils/boxGeometry';

  // The comment markers on one page: fixed-size sticky notes, moved by
  // dragging or the arrow keys, removed with the × or Delete. Editing opens a
  // floating note panel rather than turning the marker into a textarea, since
  // the marker is too small to type into (see commentEditing.svelte.ts).
  // Adding them is PDFViewer's (the Comment tool, the markup bars, the menu).

  interface Props {
    comments: PlacedComment[];
  }

  let { comments }: Props = $props();

  const page = getPageContext();
  const selection = page.selection;
  const editing = page.commentEditing;

  // Looked up fresh by id on every step, since the store emits a new object on every pointermove.
  const commentById = (id: string) => comments.find((c) => c.id === id);

  function autofocusNote(node: HTMLTextAreaElement) {
    node.focus();
  }

  let movingId: string | null = null;
  let moveOffset = { x: 0, y: 0 };

  function onPointerDown(e: PointerEvent, id: string) {
    if (selection.editingCommentId === id) return;
    e.stopPropagation();
    selection.commentId = id;
    movingId = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const markerRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    moveOffset = { x: e.clientX - markerRect.left, y: e.clientY - markerRect.top };
  }

  function onPointerMove(e: PointerEvent, id: string) {
    if (movingId !== id) return;
    const c = commentById(id);
    if (!c) return;
    const rect = page.canvasRect();
    const x = clamp(e.clientX - rect.left - moveOffset.x, 0, rect.width - c.width);
    const y = clamp(e.clientY - rect.top - moveOffset.y, 0, rect.height - c.height);
    editorStore.updateComment(id, { x, y });
  }

  function remove(id: string) {
    editorStore.removeComment(id);
    if (selection.commentId === id) selection.commentId = null;
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
    const c = commentById(id);
    if (!c) return;
    const rect = page.canvasRect();
    editorStore.updateComment(id, {
      x: clamp(c.x + step.dx, 0, rect.width - c.width),
      y: clamp(c.y + step.dy, 0, rect.height - c.height),
    });
  }
</script>

{#each comments as c (c.id)}
  {@const isSelected = selection.commentId === c.id}
  {@const isEditing = selection.editingCommentId === c.id}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    data-placed-comment={c.id}
    role="group"
    tabindex="0"
    aria-label="{c.groupId ? 'Comment on marked text' : 'Comment marker'}. Double-click to edit, drag to move, Delete to remove."
    title={c.text || 'Empty note. Double-click to edit.'}
    class="absolute flex touch-none items-center justify-center rounded-full bg-amber-400 text-amber-950
      shadow-md cursor-move {isSelected ? 'ring-2 ring-blue-400 ring-offset-1' : 'hover:bg-amber-300'}"
    style:left="{c.x}px"
    style:top="{c.y}px"
    style:width="{c.width}px"
    style:height="{c.height}px"
    onpointerdown={(e) => onPointerDown(e, c.id)}
    onpointermove={(e) => onPointerMove(e, c.id)}
    onpointerup={() => (movingId = null)}
    ondblclick={(e) => {
      e.stopPropagation();
      editing.start(c.id, c.text);
    }}
    onfocus={() => (selection.commentId = c.id)}
    onkeydown={(e) => onKeydown(e, c.id)}
  >
    <svg viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5">
      <path d="M4 5h16v11H8l-4 4V5Z" />
    </svg>

    {#if isSelected}
      <button
        type="button"
        aria-label="Remove comment"
        title="Remove comment"
        class="absolute -right-1.5 -top-1.5 flex h-5 w-5 touch-none items-center justify-center rounded-full
          border border-white bg-red-500 text-white shadow transition-colors hover:bg-red-600"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={(e) => {
          e.stopPropagation();
          remove(c.id);
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3 w-3">
          <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    {/if}

    {#if isEditing}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="absolute z-10 w-56 rounded-lg border border-neutral-200 bg-white p-2 text-left shadow-lg
          dark:border-neutral-700 dark:bg-neutral-900"
        style:left="0px"
        style:top={c.y < 100 ? `${c.height + 8}px` : '-108px'}
        onpointerdown={(e) => e.stopPropagation()}
      >
        <!-- svelte-ignore a11y_autofocus -->
        <textarea
          use:autofocusNote
          bind:value={editing.value}
          placeholder="Write a comment…"
          rows="3"
          onblur={() => editing.commit(c.id)}
          onkeydown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            editing.commit(c.id);
            commentToolMode.set(false);
          }}
          class="w-full resize-none rounded border border-neutral-200 bg-transparent p-1.5 text-xs
            text-neutral-900 outline-none focus:ring-1 focus:ring-blue-400 dark:border-neutral-700
            dark:text-neutral-100"
        ></textarea>
      </div>
    {/if}
  </div>
{/each}
