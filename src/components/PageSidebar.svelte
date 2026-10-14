<script lang="ts">
  import { editorStore, activeDocument } from '../stores/editor';
  import { pageSidebarOpen } from '../stores/layout';
  import { getCachedPdf } from '../lib/pdf/docCache';
  import { getTotalRotation, type PdfDocument } from '../lib/pdf/loader';
  import { PAGE_DRAG_TYPE } from '../lib/pdf/pageOps';
  import { tooltip } from '../lib/utils/tooltip';
  import PageThumbnail from './PageThumbnail.svelte';

  let pdfDoc: PdfDocument | null = $state(null);
  let error: string | null = $state(null);

  // Only the identity of the document matters here. Depending on the whole $activeDocument object
  // would re-run the effect (and unmount the thumbnails, resetting scroll) on every page change.
  const docId = $derived($activeDocument?.id ?? null);
  const docFile = $derived($activeDocument?.file ?? null);

  // Reloads (from the shared cache — usually a no-op parse) whenever the active document or its
  // file changes. A new file for the same document (pages edited) keeps the old thumbnails on
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

  // Taken from the loaded parse rather than the document's pageCount, so the
  // list always matches the file the thumbnails are drawn from.
  const pageNumbers = $derived(
    Array.from({ length: (pdfDoc as PdfDocument | null)?.numPages ?? 0 }, (_, i) => i + 1),
  );
  const activePageNumber = $derived($activeDocument?.pageNumber ?? 1);
  const activeRotation = $derived($activeDocument?.rotation ?? 0);

  // Space reserved for thumbnails that haven't rendered yet (see PageThumbnail),
  // using the first page's shape — most documents use one page size throughout.
  let placeholderAspect = $state(1 / Math.SQRT2);
  $effect(() => {
    const doc = pdfDoc;
    const rotation = activeRotation;
    if (!doc) return;
    doc
      .getPage(1)
      .then((page) => {
        const viewport = page.getViewport({ scale: 1, rotation: getTotalRotation(page, rotation) });
        placeholderAspect = viewport.width / viewport.height;
      })
      .catch(() => {});
  });

  // Page edits rewrite the whole file, so only one runs at a time.
  let busy = $state(false);
  let pageError: string | null = $state(null);

  async function runPageEdit(edit: () => Promise<void>, failure: string) {
    if (busy) return;
    busy = true;
    pageError = null;
    try {
      await edit();
    } catch (err) {
      pageError = err instanceof Error ? err.message : failure;
    } finally {
      busy = false;
    }
  }

  // Drag-and-drop reordering. `dropBefore` is the slot the dragged page would
  // land in: the page number it would be inserted before, or pageCount + 1
  // for the very end.
  let draggedPage: number | null = $state(null);
  let dropBefore: number | null = $state(null);

  function onDragStart(e: DragEvent, pageNumber: number) {
    if (busy || !e.dataTransfer) return;
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

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const from = draggedPage;
    const before = dropBefore;
    resetDrag();
    if (from === null || before === null) return;

    // Inserting after the page's own slot shifts everything up by one once it's removed.
    const to = before > from ? before - 1 : before;
    if (to === from) return;

    runPageEdit(() => editorStore.movePage(from, to), 'Failed to move the page');
  }

  // Whether the drop indicator line should show above/below this page — hidden
  // when dropping would leave the page where it is.
  function showIndicator(slot: number): boolean {
    return draggedPage !== null && dropBefore === slot && slot !== draggedPage && slot !== draggedPage + 1;
  }

  const actionButtonClass =
    'flex h-6 w-6 items-center justify-center rounded text-neutral-600 transition-colors hover:bg-neutral-100 ' +
    'hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-40 dark:text-neutral-300 ' +
    'dark:hover:bg-neutral-700 dark:hover:text-white';
</script>

{#if $pageSidebarOpen}
  <aside
    data-thumbnail-scroll
    class="flex w-44 shrink-0 flex-col gap-2 overflow-y-auto border-r border-neutral-200 bg-neutral-50 p-3
      dark:border-neutral-800 dark:bg-neutral-900"
    class:opacity-60={busy}
    aria-busy={busy}
  >
    {#if error}
      <p class="text-xs text-red-600">{error}</p>
    {:else if pdfDoc}
      {#if pageError}
        <p class="text-xs text-red-600 dark:text-red-400">{pageError}</p>
      {/if}
      {#each pageNumbers as pageNumber (pageNumber)}
        {@const isActive = pageNumber === activePageNumber}
        <div
          role="listitem"
          draggable={!busy && pageNumbers.length > 1}
          class="group relative cursor-grab active:cursor-grabbing"
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
            {isActive}
            {placeholderAspect}
            onSelect={() => editorStore.goToPage(pageNumber)}
          />

          <!-- Page actions: shown on hover, and always on the current page so
               they're reachable without a mouse. -->
          <div
            class="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-0.5 rounded-md border
              border-neutral-200 bg-white/95 p-0.5 shadow transition-opacity dark:border-neutral-700
              dark:bg-neutral-800/95 {isActive
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}"
          >
            <button
              type="button"
              class={actionButtonClass}
              aria-label="Rotate page {pageNumber} left"
              use:tooltip={'Rotate this page left'}
              disabled={busy}
              onclick={() => runPageEdit(() => editorStore.rotatePage(pageNumber, -90), 'Failed to rotate the page')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 3v5h5" />
              </svg>
            </button>
            <button
              type="button"
              class={actionButtonClass}
              aria-label="Rotate page {pageNumber} right"
              use:tooltip={'Rotate this page right'}
              disabled={busy}
              onclick={() => runPageEdit(() => editorStore.rotatePage(pageNumber, 90), 'Failed to rotate the page')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 3v5h-5" />
              </svg>
            </button>
            <button
              type="button"
              class={actionButtonClass}
              aria-label="Duplicate page {pageNumber}"
              use:tooltip={'Duplicate this page'}
              disabled={busy}
              onclick={() => runPageEdit(() => editorStore.duplicatePage(pageNumber), 'Failed to duplicate the page')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                <rect x="8" y="8" width="12" height="12" rx="2" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
              </svg>
            </button>
            <button
              type="button"
              class={actionButtonClass}
              aria-label="Insert a blank page after page {pageNumber}"
              use:tooltip={'Insert a blank page after this one'}
              disabled={busy}
              onclick={() => runPageEdit(() => editorStore.insertBlankPage(pageNumber), 'Failed to insert a page')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
                <path stroke-linecap="round" d="M12 11v6M9 14h6" />
              </svg>
            </button>
            <button
              type="button"
              class="{actionButtonClass} hover:!bg-red-50 hover:!text-red-600 dark:hover:!bg-red-950"
              aria-label="Delete page {pageNumber}"
              use:tooltip={pageNumbers.length > 1 ? 'Delete this page' : "The only page can't be deleted"}
              disabled={busy || pageNumbers.length <= 1}
              onclick={() => runPageEdit(() => editorStore.deletePage(pageNumber), 'Failed to delete the page')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
              </svg>
            </button>
          </div>

          {#if pageNumber === pageNumbers.length && showIndicator(pageNumber + 1)}
            <div class="pointer-events-none absolute -bottom-1.5 left-0 right-0 h-0.5 rounded bg-blue-500"></div>
          {/if}
        </div>
      {/each}
    {/if}
  </aside>
{/if}
