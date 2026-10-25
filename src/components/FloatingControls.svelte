<script lang="ts">
  import { editorStore, activeDocument, canUndo, canRedo, DEFAULT_RENDER_SCALE } from '../stores/editor';
  import { redactMode } from '../stores/redact';
  import { textToolMode } from '../stores/textTool';
  import { commentToolMode } from '../stores/commentTool';
  import { clickToPlaceMode } from '../stores/clickToPlace';
  import { signatureToolMode } from '../stores/signatureTool';
  import { zoomToolMode } from '../stores/zoomTool';
  import { textSelectMode } from '../stores/textSelect';
  import { getCachedPdf } from '../lib/pdf/docCache';
  import { getTotalRotation } from '../lib/pdf/loader';
  import { tooltip } from '../lib/utils/tooltip';
  import { screenshotToolMode, screenshotResult } from '../stores/screenshotTool';
  import { pageNumbersToolMode } from '../stores/pageNumbersTool';
  import { shapeToolMode } from '../stores/shapeTool';
  import { addImageFile, pendingImage, IMAGE_ACCEPT } from '../stores/images';
  import { downloadBlob } from '../lib/pdf/screenshot';

  const groupClass = 'flex items-center gap-0.5 rounded-full border border-neutral-200 p-0.5 dark:border-neutral-800';
  const iconButtonClass =
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 ' +
    'disabled:cursor-not-allowed disabled:opacity-30 dark:text-neutral-300 dark:hover:bg-neutral-800';
  const toolButtonClass = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors';

  const zoomPercent = $derived(Math.round(($editorStore.renderScale / DEFAULT_RENDER_SCALE) * 100));
  const pageNumbers = $derived(
    $activeDocument ? Array.from({ length: $activeDocument.pageCount }, (_, i) => i + 1) : [],
  );

  // Redact and Add Text are mutually exclusive click-driven modes on the
  // canvas — enabling one turns the other off so a click has one unambiguous meaning.
  function toggleRedactMode() {
    redactMode.update((v) => !v);
    if ($redactMode) {
      signatureToolMode.set(false);
      textToolMode.set(false);
      commentToolMode.set(false);
      zoomToolMode.set(false);
      textSelectMode.set(false);
      screenshotToolMode.set(false);
      pageNumbersToolMode.set(false);
      shapeToolMode.set(false);
    }
  }

  function toggleSignatureToolMode() {
    signatureToolMode.update((v) => !v);
    if ($signatureToolMode) {
      redactMode.set(false);
      textToolMode.set(false);
      commentToolMode.set(false);
      zoomToolMode.set(false);
      textSelectMode.set(false);
      screenshotToolMode.set(false);
      pageNumbersToolMode.set(false);
      shapeToolMode.set(false);
    }
  }

  function toggleTextToolMode() {
    textToolMode.update((v) => !v);
    if ($textToolMode) {
      redactMode.set(false);
      commentToolMode.set(false);
      clickToPlaceMode.set(false);
      signatureToolMode.set(false);
      zoomToolMode.set(false);
      textSelectMode.set(false);
      screenshotToolMode.set(false);
      pageNumbersToolMode.set(false);
      shapeToolMode.set(false);
    }
  }

  function toggleCommentToolMode() {
    commentToolMode.update((v) => !v);
    if ($commentToolMode) {
      redactMode.set(false);
      textToolMode.set(false);
      clickToPlaceMode.set(false);
      signatureToolMode.set(false);
      zoomToolMode.set(false);
      textSelectMode.set(false);
      screenshotToolMode.set(false);
      pageNumbersToolMode.set(false);
      shapeToolMode.set(false);
    }
  }

  function toggleZoomToolMode() {
    zoomToolMode.update((v) => !v);
    if ($zoomToolMode) {
      redactMode.set(false);
      textToolMode.set(false);
      commentToolMode.set(false);
      clickToPlaceMode.set(false);
      signatureToolMode.set(false);
      textSelectMode.set(false);
      screenshotToolMode.set(false);
      pageNumbersToolMode.set(false);
      shapeToolMode.set(false);
    }
  }

  function toggleTextSelectMode() {
    textSelectMode.update((v) => !v);
    if ($textSelectMode) {
      redactMode.set(false);
      textToolMode.set(false);
      commentToolMode.set(false);
      clickToPlaceMode.set(false);
      signatureToolMode.set(false);
      zoomToolMode.set(false);
      screenshotToolMode.set(false);
      pageNumbersToolMode.set(false);
      shapeToolMode.set(false);
    }
  }

  // Move is the default, non-click-driven mode: no other tool is active, the
  // canvas shows a hand/grab cursor, and dragging existing signatures/text/
  // redaction boxes around works as normal. It has no state of its own — it's
  // just "none of the other modes" — but gets its own button so the user has
  // an explicit, one-click way back to it (same effect as Escape, without
  // needing to know that shortcut).
  const moveModeActive = $derived(
    !$redactMode &&
      !$textToolMode &&
      !$commentToolMode &&
      !$clickToPlaceMode &&
      !$signatureToolMode &&
      !$zoomToolMode &&
      !$textSelectMode &&
      !$screenshotToolMode &&
      !$pageNumbersToolMode &&
      !$shapeToolMode,
  );

  function toggleScreenshotToolMode() {
    screenshotToolMode.update((v) => !v);
    if ($screenshotToolMode) {
      redactMode.set(false);
      textToolMode.set(false);
      commentToolMode.set(false);
      clickToPlaceMode.set(false);
      signatureToolMode.set(false);
      zoomToolMode.set(false);
      textSelectMode.set(false);
      pageNumbersToolMode.set(false);
      shapeToolMode.set(false);
    }
  }

  function togglePageNumbersToolMode() {
    pageNumbersToolMode.update((v) => !v);
    if ($pageNumbersToolMode) {
      redactMode.set(false);
      textToolMode.set(false);
      commentToolMode.set(false);
      clickToPlaceMode.set(false);
      signatureToolMode.set(false);
      zoomToolMode.set(false);
      textSelectMode.set(false);
      screenshotToolMode.set(false);
      shapeToolMode.set(false);
    }
  }

  function toggleShapeToolMode() {
    shapeToolMode.update((v) => !v);
    if ($shapeToolMode) {
      redactMode.set(false);
      textToolMode.set(false);
      commentToolMode.set(false);
      clickToPlaceMode.set(false);
      signatureToolMode.set(false);
      zoomToolMode.set(false);
      textSelectMode.set(false);
      screenshotToolMode.set(false);
      pageNumbersToolMode.set(false);
    }
  }

  // Add image: the picked image is placed on the current page (PDFViewer
  // picks it up from pendingImage), selected, ready to move and resize.
  let imageError: string | null = $state(null);
  let imageErrorTimeout: ReturnType<typeof setTimeout> | undefined;

  async function onImagePicked(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    clearTimeout(imageErrorTimeout);
    try {
      imageError = null;
      pendingImage.set(await addImageFile(file));
    } catch (err) {
      imageError = err instanceof Error ? err.message : 'Failed to add the image';
      imageErrorTimeout = setTimeout(() => (imageError = null), 6000);
    }
  }

  // Toast for the latest screenshot — stays a few seconds, longer if it's an error.
  let screenshotToastTimeout: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const result = $screenshotResult;
    clearTimeout(screenshotToastTimeout);
    if (result) screenshotToastTimeout = setTimeout(() => screenshotResult.set(null), result.ok ? 6000 : 8000);
  });

  function saveScreenshot() {
    const result = $screenshotResult;
    if (!result?.ok) return;
    downloadBlob(result.blob, result.fileName);
    screenshotResult.set(null);
  }

  function activateMoveMode() {
    redactMode.set(false);
    textToolMode.set(false);
    commentToolMode.set(false);
    clickToPlaceMode.set(false);
    zoomToolMode.set(false);
    textSelectMode.set(false);
    screenshotToolMode.set(false);
    pageNumbersToolMode.set(false);
    shapeToolMode.set(false);
  }

  // Fits the current page to the visible scroll area — width-only, or both
  // dimensions (whichever is more constraining). The scroll container lives
  // in App.svelte, outside this component (same reasoning as PDFViewer's
  // pan-mode lookup), so it's found via its data attribute rather than
  // prop-drilled through the tree.
  let fitting = $state(false);

  async function fitTo(mode: 'width' | 'page') {
    const doc = $activeDocument;
    const container = document.querySelector<HTMLElement>('[data-pdf-scroll-container]');
    if (!doc || !container) return;

    fitting = true;
    try {
      const pdfjsDoc = await getCachedPdf(doc.id, doc.file);
      const page = await pdfjsDoc.getPage(doc.pageNumber);
      const rotation = getTotalRotation(page, doc.rotation);
      const unscaled = page.getViewport({ scale: 1, rotation });

      const style = getComputedStyle(container);
      const availableWidth = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const availableHeight =
        container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);

      const widthScale = availableWidth / unscaled.width;
      const scale = mode === 'width' ? widthScale : Math.min(widthScale, availableHeight / unscaled.height);

      editorStore.setRenderScale(scale);
    } finally {
      fitting = false;
    }
  }
</script>

<!-- Placed by App.svelte, which keeps it still when the tool panel opens. -->
<div class="pointer-events-none flex flex-col items-center gap-1.5">
  {#if $screenshotResult}
    {@const result = $screenshotResult}
    <div
      role="status"
      class="pointer-events-auto mb-1 flex max-w-full items-center gap-2 rounded-full bg-white/90 py-1 pl-3 pr-1
        text-xs shadow dark:bg-neutral-900/90"
    >
      {#if result.ok}
        <span class="text-emerald-600 dark:text-emerald-400">
          {result.copied ? 'Screenshot copied to clipboard' : 'Screenshot ready'}
        </span>
        <button
          type="button"
          class="rounded-full bg-sky-600 px-2.5 py-0.5 font-medium text-white hover:bg-sky-700"
          onclick={saveScreenshot}
        >
          Save PNG
        </button>
      {:else}
        <span class="text-red-600 dark:text-red-400">{result.message}</span>
      {/if}
      <button
        type="button"
        aria-label="Dismiss"
        class="flex h-6 w-6 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100
          dark:text-neutral-400 dark:hover:bg-neutral-800"
        onclick={() => screenshotResult.set(null)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
          <path stroke-linecap="round" d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  {/if}

  {#if imageError}
    <div
      role="alert"
      class="pointer-events-auto mb-1 max-w-full rounded-full bg-white/90 px-3 py-1 text-xs text-red-600 shadow
        dark:bg-neutral-900/90 dark:text-red-400"
    >
      {imageError}
    </div>
  {/if}

  <div class="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-full border
    border-neutral-200 bg-white/90 px-2 py-1.5 shadow-lg backdrop-blur dark:border-neutral-800
    dark:bg-neutral-900/90">
    <div class={groupClass}>
      <button
        type="button"
        aria-label="Undo"
        use:tooltip={'Undo (Ctrl+Z)'}
        class={iconButtonClass}
        disabled={!$canUndo}
        onclick={() => editorStore.undo()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Redo"
        use:tooltip={'Redo (Ctrl+Shift+Z)'}
        class={iconButtonClass}
        disabled={!$canRedo}
        onclick={() => editorStore.redo()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 15l6-6m0 0-6-6m6 6H9a6 6 0 0 0 0 12h3" />
        </svg>
      </button>
    </div>

    <div class={groupClass}>
      <button
        type="button"
        aria-label="Previous page"
        use:tooltip={'Previous page (←)'}
        class={iconButtonClass}
        disabled={($activeDocument?.pageNumber ?? 1) <= 1}
        onclick={() => editorStore.prevPage()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
          <path stroke-linecap="round" stroke-linejoin="round" d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <select
        aria-label="Go to page"
        use:tooltip={'Go to page'}
        class="min-w-[4.5rem] rounded-full border-none bg-transparent px-1 py-0.5 text-center text-xs tabular-nums
          text-neutral-500 hover:bg-neutral-100 focus:outline-none focus:ring-1 focus:ring-blue-400
          disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent
          dark:text-neutral-400 dark:hover:bg-neutral-800"
        disabled={($activeDocument?.pageCount ?? 1) <= 1}
        value={$activeDocument?.pageNumber}
        onchange={(e) => editorStore.goToPage(Number((e.target as HTMLSelectElement).value))}
      >
        {#each pageNumbers as pageNumber (pageNumber)}
          <option value={pageNumber}>Page {pageNumber} / {$activeDocument?.pageCount}</option>
        {/each}
      </select>
      <button
        type="button"
        aria-label="Next page"
        use:tooltip={'Next page (→)'}
        class={iconButtonClass}
        disabled={($activeDocument?.pageNumber ?? 1) >= ($activeDocument?.pageCount ?? 1)}
        onclick={() => editorStore.nextPage()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
          <path stroke-linecap="round" stroke-linejoin="round" d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>

    <div class={groupClass}>
      <button
        type="button"
        aria-label="Zoom out"
        use:tooltip={'Zoom out'}
        class={iconButtonClass}
        onclick={() => editorStore.zoomOut()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
          <path stroke-linecap="round" d="M5 12h14" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Reset zoom"
        use:tooltip={'Reset zoom'}
        class="w-12 rounded-full px-1 py-0.5 text-center text-xs tabular-nums text-neutral-500 hover:bg-neutral-100
          dark:text-neutral-400 dark:hover:bg-neutral-800"
        onclick={() => editorStore.resetZoom()}
      >
        {zoomPercent}%
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        use:tooltip={'Zoom in'}
        class={iconButtonClass}
        onclick={() => editorStore.zoomIn()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
          <path stroke-linecap="round" d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>

    <div class={groupClass}>
      <button
        type="button"
        aria-label="Fit width"
        use:tooltip={'Fit page width to the window'}
        class={iconButtonClass}
        disabled={fitting}
        onclick={() => fitTo('width')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 12h18" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M8 7l-5 5 5 5" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M16 7l5 5-5 5" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Fit page"
        use:tooltip={'Fit the whole page to the window'}
        class={iconButtonClass}
        disabled={fitting}
        onclick={() => fitTo('page')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
          <rect x="6" y="4" width="12" height="16" rx="1" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 2v2M18 2v2M6 20v2M18 20v2" />
        </svg>
      </button>
    </div>

    <div class={groupClass}>
      <button
        type="button"
        aria-label="Rotate left"
        use:tooltip={'Rotate left'}
        class={iconButtonClass}
        onclick={() => editorStore.rotateLeft()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
          <rect x="8" y="6" width="12" height="15" rx="1.5" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 9a5 5 0 0 1 5-5h1" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v4h4" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Rotate right"
        use:tooltip={'Rotate right'}
        class={iconButtonClass}
        onclick={() => editorStore.rotateRight()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
          <rect x="4" y="6" width="12" height="15" rx="1.5" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9a5 5 0 0 0-5-5h-1" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M20 4v4h-4" />
        </svg>
      </button>
    </div>

    <button
      type="button"
      aria-label="Move"
      aria-pressed={moveModeActive}
      use:tooltip={'Move: drag existing signatures, text, or redactions around (default)'}
      class={toolButtonClass}
      class:border-neutral-200={!moveModeActive}
      class:text-neutral-600={!moveModeActive}
      class:hover:bg-neutral-100={!moveModeActive}
      class:dark:border-neutral-800={!moveModeActive}
      class:dark:text-neutral-300={!moveModeActive}
      class:dark:hover:bg-neutral-800={!moveModeActive}
      class:border-neutral-900={moveModeActive}
      class:bg-neutral-900={moveModeActive}
      class:text-white={moveModeActive}
      class:dark:border-neutral-100={moveModeActive}
      class:dark:bg-neutral-100={moveModeActive}
      class:dark:text-neutral-900={moveModeActive}
      onclick={activateMoveMode}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M9 11.5V6a1.5 1.5 0 0 1 3 0v5M12 11.5V5a1.5 1.5 0 0 1 3 0v6.5M15 11.5V7a1.5 1.5 0 0 1 3 0v7c0 3.31-2.69 6-6 6h-1c-2 0-3-.5-4-2l-2.7-3.6a1.4 1.4 0 0 1 .3-1.9 1.4 1.4 0 0 1 1.8.1L9 15"
        />
      </svg>
    </button>

    <button
      type="button"
      aria-label="Signature"
      aria-pressed={$signatureToolMode}
      use:tooltip={'Signature: open the signature panel to place, manage, and watermark signatures'}
      class={toolButtonClass}
      class:border-neutral-200={!$signatureToolMode}
      class:text-neutral-600={!$signatureToolMode}
      class:hover:bg-neutral-100={!$signatureToolMode}
      class:dark:border-neutral-800={!$signatureToolMode}
      class:dark:text-neutral-300={!$signatureToolMode}
      class:dark:hover:bg-neutral-800={!$signatureToolMode}
      class:border-indigo-600={$signatureToolMode}
      class:bg-indigo-600={$signatureToolMode}
      class:text-white={$signatureToolMode}
      onclick={toggleSignatureToolMode}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 20l4-1 10-10a2.121 2.121 0 0 0-3-3L5 16l-1 4z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l3 3" />
      </svg>
    </button>

    <button
      type="button"
      aria-label="Redact"
      aria-pressed={$redactMode}
      use:tooltip={'Redact: draw a box to permanently remove content from the exported PDF'}
      class={toolButtonClass}
      class:border-neutral-200={!$redactMode}
      class:text-neutral-600={!$redactMode}
      class:hover:bg-neutral-100={!$redactMode}
      class:dark:border-neutral-800={!$redactMode}
      class:dark:text-neutral-300={!$redactMode}
      class:dark:hover:bg-neutral-800={!$redactMode}
      class:border-red-600={$redactMode}
      class:bg-red-600={$redactMode}
      class:text-white={$redactMode}
      onclick={toggleRedactMode}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path stroke-linecap="round" d="M8 12h8" />
      </svg>
    </button>

    <button
      type="button"
      aria-label="Add Text"
      aria-pressed={$textToolMode}
      use:tooltip={'Add Text: click on the document to place a text box'}
      class={toolButtonClass}
      class:border-neutral-200={!$textToolMode}
      class:text-neutral-600={!$textToolMode}
      class:hover:bg-neutral-100={!$textToolMode}
      class:dark:border-neutral-800={!$textToolMode}
      class:dark:text-neutral-300={!$textToolMode}
      class:dark:hover:bg-neutral-800={!$textToolMode}
      class:border-blue-600={$textToolMode}
      class:bg-blue-600={$textToolMode}
      class:text-white={$textToolMode}
      onclick={toggleTextToolMode}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 6h14M12 6v12" />
      </svg>
    </button>

    <button
      type="button"
      aria-label="Comment"
      aria-pressed={$commentToolMode}
      use:tooltip={'Comment: click on the document to leave a sticky note'}
      class={toolButtonClass}
      class:border-neutral-200={!$commentToolMode}
      class:text-neutral-600={!$commentToolMode}
      class:hover:bg-neutral-100={!$commentToolMode}
      class:dark:border-neutral-800={!$commentToolMode}
      class:dark:text-neutral-300={!$commentToolMode}
      class:dark:hover:bg-neutral-800={!$commentToolMode}
      class:border-amber-500={$commentToolMode}
      class:bg-amber-500={$commentToolMode}
      class:text-white={$commentToolMode}
      onclick={toggleCommentToolMode}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 5h16v11H8l-4 4V5Z" />
      </svg>
    </button>

    <button
      type="button"
      aria-label="Zoom"
      aria-pressed={$zoomToolMode}
      use:tooltip={'Zoom: click to zoom in, right-click to zoom out'}
      class={toolButtonClass}
      class:border-neutral-200={!$zoomToolMode}
      class:text-neutral-600={!$zoomToolMode}
      class:hover:bg-neutral-100={!$zoomToolMode}
      class:dark:border-neutral-800={!$zoomToolMode}
      class:dark:text-neutral-300={!$zoomToolMode}
      class:dark:hover:bg-neutral-800={!$zoomToolMode}
      class:border-purple-600={$zoomToolMode}
      class:bg-purple-600={$zoomToolMode}
      class:text-white={$zoomToolMode}
      onclick={toggleZoomToolMode}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
        <circle cx="10" cy="10" r="6" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M10 7v6M7 10h6" />
        <path stroke-linecap="round" stroke-linejoin="round" d="m20 20-5.5-5.5" />
      </svg>
    </button>

    <button
      type="button"
      aria-label="Select"
      aria-pressed={$textSelectMode}
      use:tooltip={'Select: drag over the document to select and copy its real text'}
      class={toolButtonClass}
      class:border-neutral-200={!$textSelectMode}
      class:text-neutral-600={!$textSelectMode}
      class:hover:bg-neutral-100={!$textSelectMode}
      class:dark:border-neutral-800={!$textSelectMode}
      class:dark:text-neutral-300={!$textSelectMode}
      class:dark:hover:bg-neutral-800={!$textSelectMode}
      class:border-emerald-600={$textSelectMode}
      class:bg-emerald-600={$textSelectMode}
      class:text-white={$textSelectMode}
      onclick={toggleTextSelectMode}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8 5h8M12 5v14M8 19h8" />
      </svg>
    </button>

    <button
      type="button"
      aria-label="Screenshot"
      aria-pressed={$screenshotToolMode}
      use:tooltip={'Screenshot: click a page to capture all of it, or drag to capture an area'}
      class={toolButtonClass}
      class:border-neutral-200={!$screenshotToolMode}
      class:text-neutral-600={!$screenshotToolMode}
      class:hover:bg-neutral-100={!$screenshotToolMode}
      class:dark:border-neutral-800={!$screenshotToolMode}
      class:dark:text-neutral-300={!$screenshotToolMode}
      class:dark:hover:bg-neutral-800={!$screenshotToolMode}
      class:border-sky-600={$screenshotToolMode}
      class:bg-sky-600={$screenshotToolMode}
      class:text-white={$screenshotToolMode}
      onclick={toggleScreenshotToolMode}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>

    <button
      type="button"
      aria-label="Page numbers, header & footer"
      aria-pressed={$pageNumbersToolMode}
      use:tooltip={'Page numbers, header & footer: number the pages, or add text along their top and bottom'}
      class={toolButtonClass}
      class:border-neutral-200={!$pageNumbersToolMode}
      class:text-neutral-600={!$pageNumbersToolMode}
      class:hover:bg-neutral-100={!$pageNumbersToolMode}
      class:dark:border-neutral-800={!$pageNumbersToolMode}
      class:dark:text-neutral-300={!$pageNumbersToolMode}
      class:dark:hover:bg-neutral-800={!$pageNumbersToolMode}
      class:border-teal-600={$pageNumbersToolMode}
      class:bg-teal-600={$pageNumbersToolMode}
      class:text-white={$pageNumbersToolMode}
      onclick={togglePageNumbersToolMode}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
        <rect x="5" y="3" width="14" height="18" rx="1.5" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M11 14.5l1.5-1V18M10.5 18h3.5" />
      </svg>
    </button>

    <button
      type="button"
      aria-label="Shapes"
      aria-pressed={$shapeToolMode}
      use:tooltip={'Shapes: drag on the page to draw a rectangle, ellipse, line, or arrow'}
      class={toolButtonClass}
      class:border-neutral-200={!$shapeToolMode}
      class:text-neutral-600={!$shapeToolMode}
      class:hover:bg-neutral-100={!$shapeToolMode}
      class:dark:border-neutral-800={!$shapeToolMode}
      class:dark:text-neutral-300={!$shapeToolMode}
      class:dark:hover:bg-neutral-800={!$shapeToolMode}
      class:border-fuchsia-600={$shapeToolMode}
      class:bg-fuchsia-600={$shapeToolMode}
      class:text-white={$shapeToolMode}
      onclick={toggleShapeToolMode}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
        <rect x="3" y="11" width="10" height="10" rx="1" />
        <circle cx="16" cy="8" r="5" />
      </svg>
    </button>

    <label
      aria-label="Add image"
      use:tooltip={'Add image: place a picture or logo on the page (or drop an image file onto a page)'}
      class="{toolButtonClass} cursor-pointer border-neutral-200 text-neutral-600 hover:bg-neutral-100
        dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      <input type="file" accept={IMAGE_ACCEPT} class="hidden" onchange={onImagePicked} />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="2" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M21 16l-5-5-9 9" />
      </svg>
    </label>
  </div>
</div>
