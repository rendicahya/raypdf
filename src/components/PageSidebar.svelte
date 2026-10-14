<script lang="ts">
  import { editorStore, activeDocument } from '../stores/editor';
  import { pageSidebarOpen } from '../stores/layout';
  import { getCachedPdf } from '../lib/pdf/docCache';
  import { PAGE_DRAG_TYPE } from '../lib/pdf/reorder';
  import type { PdfDocument } from '../lib/pdf/loader';
  import PageThumbnail from './PageThumbnail.svelte';

  let pdfDoc: PdfDocument | null = $state(null);
  let error: string | null = $state(null);

  // Only the identity of the document matters here. Depending on the whole $activeDocument object
  // would re-run the effect (and unmount the thumbnails, resetting scroll) on every page change.
  const docId = $derived($activeDocument?.id ?? null);
  const docFile = $derived($activeDocument?.file ?? null);

  // Reloads (from the shared cache — usually a no-op parse) whenever the active document or its
  // file changes. A new file for the same document (pages reordered) keeps the old thumbnails on
  // screen until the new one is ready, so the list and its scroll position don't flash away.
  let loadedId: string | null = null;
  $effect(() => {
    const id = docId;
    const file = docFile;
    if (id === null || !file) {
      pdfDoc = null;
      loadedId = null;
      return;
    }
    let cancelled = false;
    if (id !== loadedId) pdfDoc = null;
    error = null;
    getCachedPdf(id, file)
      .then((loaded) => {
        if (cancelled) return;
        pdfDoc = loaded;
        loadedId = id;
      })
      .catch((e) => {
        if (!cancelled) error = e instanceof Error ? e.message : 'Failed to load PDF';
      });
    return () => {
      cancelled = true;
    };
  });

  const pageNumbers = $derived(
    $activeDocument ? Array.from({ length: $activeDocument.pageCount }, (_, i) => i + 1) : [],
  );
  const activePageNumber = $derived($activeDocument?.pageNumber ?? 1);
  const activeRotation = $derived($activeDocument?.rotation ?? 0);

  // Drag-and-drop reordering. `dropBefore` is the slot the dragged page would
  // land in: the page number it would be inserted before, or pageCount + 1
  // for the very end.
  let draggedPage: number | null = $state(null);
  let dropBefore: number | null = $state(null);
  let moving = $state(false);
  let moveError: string | null = $state(null);

  function onDragStart(e: DragEvent, pageNumber: number) {
    if (moving || !e.dataTransfer) return;
    draggedPage = pageNumber;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(PAGE_DRAG_TYPE, String(pageNumber));
  }

  function onDragOver(e: DragEvent, pageNumber: number) {
    if (draggedPage === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropBefore = e.clientY < rect.top + rect.height / 2 ? pageNumber : pageNumber + 1;
  }

  function resetDrag() {
    draggedPage = null;
    dropBefore = null;
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    const from = draggedPage;
    const before = dropBefore;
    resetDrag();
    if (from === null || before === null) return;

    // Inserting after the page's own slot shifts everything up by one once it's removed.
    const to = before > from ? before - 1 : before;
    if (to === from) return;

    moving = true;
    moveError = null;
    try {
      await editorStore.movePage(from, to);
    } catch (err) {
      moveError = err instanceof Error ? err.message : 'Failed to move the page';
    } finally {
      moving = false;
    }
  }

  // Whether the drop indicator line should show above/below this page — hidden
  // when dropping would leave the page where it is.
  function showIndicator(slot: number): boolean {
    return draggedPage !== null && dropBefore === slot && slot !== draggedPage && slot !== draggedPage + 1;
  }
</script>

{#if $pageSidebarOpen}
  <aside
    class="flex w-44 shrink-0 flex-col gap-2 overflow-y-auto border-r border-neutral-200 bg-neutral-50 p-3
      dark:border-neutral-800 dark:bg-neutral-900"
    class:opacity-60={moving}
    aria-busy={moving}
  >
    {#if error}
      <p class="text-xs text-red-600">{error}</p>
    {:else if pdfDoc}
      {#if moveError}
        <p class="text-xs text-red-600 dark:text-red-400">{moveError}</p>
      {/if}
      {#each pageNumbers as pageNumber (pageNumber)}
        <div
          role="listitem"
          draggable={!moving && pageNumbers.length > 1}
          class="relative cursor-grab active:cursor-grabbing"
          class:opacity-40={draggedPage === pageNumber}
          ondragstart={(e) => onDragStart(e, pageNumber)}
          ondragover={(e) => onDragOver(e, pageNumber)}
          ondrop={onDrop}
          ondragend={resetDrag}
        >
          {#if showIndicator(pageNumber)}
            <div class="pointer-events-none absolute -top-1.5 left-0 right-0 h-0.5 rounded bg-blue-500"></div>
          {/if}
          <PageThumbnail
            {pdfDoc}
            {pageNumber}
            rotation={activeRotation}
            isActive={pageNumber === activePageNumber}
            onSelect={() => editorStore.goToPage(pageNumber)}
          />
          {#if pageNumber === pageNumbers.length && showIndicator(pageNumber + 1)}
            <div class="pointer-events-none absolute -bottom-1.5 left-0 right-0 h-0.5 rounded bg-blue-500"></div>
          {/if}
        </div>
      {/each}
    {/if}
  </aside>
{/if}
