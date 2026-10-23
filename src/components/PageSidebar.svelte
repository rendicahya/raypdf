<script lang="ts">
  import { editorStore, activeDocument } from '../stores/editor';
  import {
    pageSidebarOpen,
    pageSidebarWidth,
    PAGE_SIDEBAR_MIN_WIDTH,
    PAGE_SIDEBAR_MAX_WIDTH,
    PAGE_SIDEBAR_DEFAULT_WIDTH,
  } from '../stores/layout';
  import { signatureStore } from '../stores/signature';
  import { currentWatermarkOptions } from '../stores/watermark';
  import { stripEmbeddedScripts, securePdf } from '../stores/exportOptions';
  import { getCachedPdf } from '../lib/pdf/docCache';
  import { getTotalRotation, type PdfDocument } from '../lib/pdf/loader';
  import { PAGE_DRAG_TYPE } from '../lib/pdf/pageOps';
  import { exportSignedPdf, downloadSelectedPagesPdf } from '../lib/pdf/export';
  import { tooltip } from '../lib/utils/tooltip';
  import PageThumbnail from './PageThumbnail.svelte';
  import ContextMenu, { type ContextMenuItem } from './ContextMenu.svelte';
  import { MENU_ICONS } from '../lib/utils/menuIcons';

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

  // Multi-page selection: Ctrl/⌘-click toggles a page, Shift-click selects a
  // range, and each thumbnail's checkbox toggles it too. A plain click just
  // navigates and clears the selection. Kept sorted.
  let selected: number[] = $state([]);
  let anchor: number | null = null;
  const selectedSet = $derived(new Set(selected));
  const selecting = $derived(selected.length > 0);

  function clearSelection() {
    selected = [];
    anchor = null;
  }

  // A different document has different pages.
  $effect(() => {
    void docId;
    clearSelection();
  });

  // Undo or a page edit can shorten the document under the selection.
  $effect(() => {
    const count = pageNumbers.length;
    if (count > 0 && selected.some((p) => p > count)) selected = selected.filter((p) => p <= count);
  });

  function range(from: number, to: number): number[] {
    const [lo, hi] = from < to ? [from, to] : [to, from];
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }

  function togglePage(pageNumber: number) {
    selected = selectedSet.has(pageNumber)
      ? selected.filter((p) => p !== pageNumber)
      : [...selected, pageNumber].sort((a, b) => a - b);
    anchor = pageNumber;
  }

  function onThumbnailClick(e: MouseEvent, pageNumber: number) {
    if (e.shiftKey) {
      const from = anchor ?? activePageNumber;
      const extra = e.ctrlKey || e.metaKey ? selected : [];
      selected = [...new Set([...extra, ...range(from, pageNumber)])].sort((a, b) => a - b);
    } else if (e.ctrlKey || e.metaKey) {
      // Starting a selection includes the page being viewed, like a file list.
      if (!selecting && pageNumber !== activePageNumber) selected = [activePageNumber];
      togglePage(pageNumber);
    } else {
      clearSelection();
      anchor = pageNumber;
    }
    editorStore.goToPage(pageNumber);
  }

  function selectAll() {
    selected = [...pageNumbers];
  }

  const canDeleteSelected = $derived(selecting && selected.length < pageNumbers.length);

  function deleteSelected() {
    if (!canDeleteSelected) return;
    const pages = selected;
    runPageEdit(async () => {
      await editorStore.deletePages(pages);
      clearSelection();
    }, 'Failed to delete the pages');
  }

  function rotateSelected(delta: number) {
    const pages = selected;
    runPageEdit(() => editorStore.rotatePages(pages, delta), 'Failed to rotate the pages');
  }

  // Saves just the given pages, with everything placed on them, as one PDF.
  async function exportPages(pages: number[]) {
    const doc = $activeDocument;
    if (!doc || pages.length === 0 || busy) return;
    const signatureBlob = $signatureStore.signature?.blob;
    const placements = signatureBlob ? doc.placedSignatures : [];
    busy = true;
    pageError = null;
    try {
      const bytes = await exportSignedPdf({
        pdfFile: doc.file,
        documentId: doc.id,
        signatureBlob: placements.length > 0 ? signatureBlob : undefined,
        placements: placements.length > 0 ? placements : undefined,
        renderScale: $editorStore.renderScale,
        rotation: doc.rotation,
        watermark: currentWatermarkOptions(),
        stripScripts: $stripEmbeddedScripts,
        redactions: doc.redactions,
        texts: doc.texts,
        comments: doc.comments,
        highlights: doc.highlights,
        formValues: doc.formValues,
        onlyPages: pages,
        securePdf: $securePdf,
      });
      downloadSelectedPagesPdf(bytes, doc.file.name, pages);
      editorStore.markExported();
    } catch (err) {
      pageError = err instanceof Error ? err.message : 'Failed to export the pages';
    } finally {
      busy = false;
    }
  }

  // Thumbnail render scale for the current width: enough for a letter-size
  // page (612pt) to fill the column, in steps so a drag doesn't re-render
  // on every pixel, and never below the original 0.22.
  const THUMB_SCALE_STEP = 0.11;
  const thumbScale = $derived(
    Math.max(0.22, Math.ceil(($pageSidebarWidth - 34) / 612 / THUMB_SCALE_STEP) * THUMB_SCALE_STEP),
  );

  // Resizing by dragging the sidebar's right edge (or arrow keys on it).
  let resizing = $state(false);
  let resizeStart = { pointerX: 0, width: 0 };

  function setWidth(width: number) {
    pageSidebarWidth.set(Math.round(Math.min(Math.max(width, PAGE_SIDEBAR_MIN_WIDTH), PAGE_SIDEBAR_MAX_WIDTH)));
  }

  function onResizePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    resizing = true;
    resizeStart = { pointerX: e.clientX, width: $pageSidebarWidth };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onResizePointerMove(e: PointerEvent) {
    if (resizing) setWidth(resizeStart.width + e.clientX - resizeStart.pointerX);
  }

  function onResizePointerUp() {
    resizing = false;
  }

  function onResizeKeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') setWidth($pageSidebarWidth - step);
    else if (e.key === 'ArrowRight') setWidth($pageSidebarWidth + step);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  // Right-click menu on a thumbnail. Right-clicking a page that's part of the
  // selection acts on the whole selection; any other page becomes the only
  // one selected first, like a file manager.
  let menu: { x: number; y: number; items: ContextMenuItem[] } | null = $state(null);

  function onThumbnailContextMenu(e: MouseEvent, pageNumber: number) {
    if (busy) return;
    e.preventDefault();
    if (!selectedSet.has(pageNumber)) clearSelection();
    const pages = selectedSet.has(pageNumber) ? selected : [pageNumber];
    const many = pages.length > 1;
    const count = many ? `${pages.length} pages` : 'page';
    const canDelete = pages.length < pageNumbers.length;

    const items: ContextMenuItem[] = [
      {
        label: many ? `Rotate ${count} left` : 'Rotate left',
        icon: MENU_ICONS.rotateLeft,
        onSelect: () => runPageEdit(() => editorStore.rotatePages(pages, -90), 'Failed to rotate'),
      },
      {
        label: many ? `Rotate ${count} right` : 'Rotate right',
        icon: MENU_ICONS.rotateRight,
        onSelect: () => runPageEdit(() => editorStore.rotatePages(pages, 90), 'Failed to rotate'),
      },
      ...(many
        ? []
        : [
            {
              label: 'Duplicate',
              icon: MENU_ICONS.duplicate,
              onSelect: () => {
                clearSelection();
                runPageEdit(() => editorStore.duplicatePage(pageNumber), 'Failed to duplicate the page');
              },
            },
            {
              label: 'Insert blank page after',
              icon: MENU_ICONS.insert,
              onSelect: () => {
                clearSelection();
                runPageEdit(() => editorStore.insertBlankPage(pageNumber), 'Failed to insert a page');
              },
            },
          ]),
      {
        label: many ? `Save ${count} as PDF` : 'Save page as PDF',
        icon: MENU_ICONS.save,
        separatorBefore: true,
        onSelect: () => exportPages(pages),
      },
      many
        ? { label: 'Clear selection', icon: MENU_ICONS.clear, hint: 'Esc', separatorBefore: true, onSelect: clearSelection }
        : {
            label: 'Select page',
            icon: MENU_ICONS.select,
            separatorBefore: true,
            onSelect: () => togglePage(pageNumber),
          },
      {
        label: 'Select all pages',
        icon: MENU_ICONS.select,
        hint: 'Ctrl+A',
        disabled: selected.length === pageNumbers.length,
        onSelect: selectAll,
      },
      {
        label: many ? `Delete ${count}` : 'Delete page',
        icon: MENU_ICONS.delete,
        hint: 'Del',
        danger: true,
        separatorBefore: true,
        disabled: !canDelete,
        onSelect: () => {
          clearSelection();
          runPageEdit(() => editorStore.deletePages(pages), 'Failed to delete');
        },
      },
    ];

    menu = { x: e.clientX, y: e.clientY, items };
  }

  function onSidebarKeydown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAll();
    } else if (selecting && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      deleteSelected();
    } else if (selecting && e.key === 'Escape') {
      e.stopPropagation();
      clearSelection();
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

    clearSelection();
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
  <div class="relative flex shrink-0" style:width="{$pageSidebarWidth}px">
  <!-- Keyboard shortcuts for the selection (Ctrl+A, Delete, Escape) arrive
       from whichever thumbnail or checkbox has focus. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <aside
    data-thumbnail-scroll
    class="flex w-full select-none flex-col gap-2 overflow-y-auto border-r border-neutral-200 bg-neutral-50
      p-3 dark:border-neutral-800 dark:bg-neutral-900"
    class:opacity-60={busy}
    aria-busy={busy}
    onkeydown={onSidebarKeydown}
  >
    {#if error}
      <p class="text-xs text-red-600">{error}</p>
    {:else if pdfDoc}
      {#if selecting}
        <div
          class="sticky -top-3 z-10 -mx-3 -mt-3 flex flex-col gap-1.5 border-b border-neutral-200 bg-neutral-50/95 px-3
            py-2 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95"
        >
          <div class="flex items-center justify-between text-[11px] text-neutral-600 dark:text-neutral-300">
            <span class="font-medium">
              {selected.length} {selected.length === 1 ? 'page' : 'pages'} selected
            </span>
            <button
              type="button"
              class={actionButtonClass}
              aria-label="Clear selection"
              use:tooltip={'Clear selection (Esc)'}
              onclick={clearSelection}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div class="flex items-center justify-between">
            <button
              type="button"
              class={actionButtonClass}
              aria-label="Select all pages"
              use:tooltip={'Select all pages (Ctrl+A)'}
              disabled={busy || selected.length === pageNumbers.length}
              onclick={selectAll}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <path stroke-linecap="round" stroke-linejoin="round" d="m8 12 3 3 5-6" />
              </svg>
            </button>
            <button
              type="button"
              class={actionButtonClass}
              aria-label="Rotate selected pages left"
              use:tooltip={'Rotate selected pages left'}
              disabled={busy}
              onclick={() => rotateSelected(-90)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 3v5h5" />
              </svg>
            </button>
            <button
              type="button"
              class={actionButtonClass}
              aria-label="Rotate selected pages right"
              use:tooltip={'Rotate selected pages right'}
              disabled={busy}
              onclick={() => rotateSelected(90)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 3v5h-5" />
              </svg>
            </button>
            <button
              type="button"
              class={actionButtonClass}
              aria-label="Save selected pages as a PDF"
              use:tooltip={'Save selected pages as a PDF'}
              disabled={busy}
              onclick={() => exportPages(selected)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />
              </svg>
            </button>
            <button
              type="button"
              class="{actionButtonClass} hover:!bg-red-50 hover:!text-red-600 dark:hover:!bg-red-950"
              aria-label="Delete selected pages"
              use:tooltip={canDeleteSelected ? 'Delete selected pages (Delete)' : "Every page can't be deleted"}
              disabled={busy || !canDeleteSelected}
              onclick={deleteSelected}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
              </svg>
            </button>
          </div>
        </div>
      {/if}
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
          oncontextmenu={(e) => onThumbnailContextMenu(e, pageNumber)}
        >
          {#if showIndicator(pageNumber)}
            <div class="pointer-events-none absolute -top-1.5 left-0 right-0 h-0.5 rounded bg-blue-500"></div>
          {/if}
          <PageThumbnail
            {pdfDoc}
            {pageNumber}
            rotation={activeRotation}
            {isActive}
            isSelected={selectedSet.has(pageNumber)}
            {placeholderAspect}
            scale={thumbScale}
            onSelect={(e) => onThumbnailClick(e, pageNumber)}
          />

          <!-- Selection checkbox: on hover, and on every page once a selection exists. -->
          <input
            type="checkbox"
            aria-label="Select page {pageNumber}"
            use:tooltip={'Select this page (or Ctrl/Shift-click pages)'}
            class="absolute bottom-1.5 left-2 h-3.5 w-3.5 cursor-pointer rounded border-neutral-300 text-blue-600
              transition-opacity focus:ring-blue-500 dark:border-neutral-600 {selecting
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}"
            checked={selectedSet.has(pageNumber)}
            disabled={busy}
            onclick={(e) => {
              e.stopPropagation();
              if (e.shiftKey && anchor !== null) {
                selected = [...new Set([...selected, ...range(anchor, pageNumber)])].sort((a, b) => a - b);
              } else {
                togglePage(pageNumber);
              }
              // A range can leave an already-selected box ticked, which the
              // browser just unticked — put it back in line with the state.
              e.currentTarget.checked = selected.includes(pageNumber);
            }}
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
              onclick={() => {
                clearSelection();
                runPageEdit(() => editorStore.duplicatePage(pageNumber), 'Failed to duplicate the page');
              }}
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
              onclick={() => {
                clearSelection();
                runPageEdit(() => editorStore.insertBlankPage(pageNumber), 'Failed to insert a page');
              }}
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
              onclick={() => {
                clearSelection();
                runPageEdit(() => editorStore.deletePage(pageNumber), 'Failed to delete the page');
              }}
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

  <!-- Drag the edge to resize; double-click resets. Outside the scrolling
       aside so it stays put while the thumbnails scroll. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    aria-label="Resize page sidebar"
    aria-valuenow={$pageSidebarWidth}
    aria-valuemin={PAGE_SIDEBAR_MIN_WIDTH}
    aria-valuemax={PAGE_SIDEBAR_MAX_WIDTH}
    use:tooltip={'Drag to resize · double-click to reset'}
    class="absolute -right-1 bottom-0 top-0 z-20 w-2 cursor-col-resize touch-none transition-colors
      hover:bg-blue-400/40 focus:bg-blue-400/40 focus:outline-none {resizing ? 'bg-blue-400/60' : ''}"
    onpointerdown={onResizePointerDown}
    onpointermove={onResizePointerMove}
    onpointerup={onResizePointerUp}
    onpointercancel={onResizePointerUp}
    ondblclick={() => pageSidebarWidth.set(PAGE_SIDEBAR_DEFAULT_WIDTH)}
    onkeydown={onResizeKeydown}
  ></div>
  </div>
{/if}

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}
