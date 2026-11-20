<script lang="ts">
  import { editorStore, activeDocument, canUndo, canRedo, DEFAULT_RENDER_SCALE } from '../stores/editor';
  import { clickToPlaceMode } from '../stores/clickToPlace';
  import { activeTool, toggleTool, turnOffTools } from '../stores/tools';
  import { getCachedPdf } from '../lib/pdf/docCache';
  import { getTotalRotation } from '../lib/pdf/loader';
  import { tooltip } from '../lib/utils/tooltip';
  import { screenshotResult } from '../stores/screenshotTool';
  import ToolButton from './ToolButton.svelte';
  import {
    ocrAreaMode,
    ocrStatus,
    isOcrRunning,
    recognizeText,
    startAreaSelection,
    stopAreaSelection,
    ocrLanguage,
  } from '../stores/ocr';
  import { OCR_LANGUAGES, ocrLanguageLabel } from '../lib/pdf/ocrLanguages';
  import ContextMenu, { type ContextMenuItem } from './ContextMenu.svelte';
  import { MENU_ICONS } from '../lib/utils/menuIcons';
  import { addImageFile, pendingImage, IMAGE_ACCEPT } from '../stores/images';
  import { downloadBlob } from '../lib/pdf/screenshot';

  const groupClass = 'flex items-center gap-0.5 rounded-full border border-neutral-200 p-0.5 dark:border-neutral-800';
  const iconButtonClass =
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 ' +
    'disabled:cursor-not-allowed disabled:opacity-30 dark:text-neutral-300 dark:hover:bg-neutral-800';
  // Add image is a file picker, not a tool, but looks like the ToolButtons beside it.
  const toolButtonClass = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors';
  // Separates the groups of tools: basics, sign and fill, mark up, protect, pages.
  const dividerClass = 'h-6 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700';

  const zoomPercent = $derived(Math.round(($editorStore.renderScale / DEFAULT_RENDER_SCALE) * 100));
  const pageNumbers = $derived(
    $activeDocument ? Array.from({ length: $activeDocument.pageCount }, (_, i) => i + 1) : [],
  );

  // Move is the default, non-click-driven mode: no tool is on, the canvas
  // shows a hand/grab cursor, and dragging existing signatures/text/
  // redaction boxes around works as normal. It has no state of its own (it's
  // "none of the other modes") but gets its own button so the user has an
  // explicit, one-click way back to it (same effect as Escape, without
  // needing to know that shortcut). The Signature tool already behaves like
  // Move on the canvas, so Move leaves its panel open and only ends
  // click-to-place.
  const moveModeActive = $derived($activeTool === null && !$clickToPlaceMode && !$ocrAreaMode);

  function activateMoveMode() {
    turnOffTools('signature');
    clickToPlaceMode.set(false);
    stopAreaSelection();
  }

  // Recognize text: on the current page, on every page without text, or in
  // an area the user drags (which then behaves like a tool).
  let ocrMenu: { x: number; y: number } | null = $state(null);
  const ocrMenuItems: ContextMenuItem[] = $derived([
    {
      label: 'Recognize text on this page',
      icon: MENU_ICONS.recognize,
      onSelect: () => {
        if ($activeDocument) recognizeText([$activeDocument.pageNumber]);
      },
    },
    { label: 'Recognize text on every page', icon: MENU_ICONS.recognize, onSelect: () => recognizeText() },
    { label: 'Recognize text in an area', icon: MENU_ICONS.recognizeArea, onSelect: startAreaSelection },
    {
      label: `Language: ${ocrLanguageLabel($ocrLanguage)}`,
      icon: MENU_ICONS.language,
      separatorBefore: true,
      children: OCR_LANGUAGES.map(({ code, label }) => ({
        label,
        icon: code === $ocrLanguage ? MENU_ICONS.check : undefined,
        onSelect: () => ocrLanguage.set(code),
      })),
    },
  ]);

  // The menu closes on any pointerdown outside it, including the button's
  // own, so a click right after that closing mustn't open it again.
  let ocrMenuClosedAt = 0;

  function closeOcrMenu() {
    ocrMenu = null;
    ocrMenuClosedAt = performance.now();
  }

  function toggleOcrMenu(e: MouseEvent) {
    // While waiting for an area, the button turns it off like any other tool.
    if ($ocrAreaMode) {
      stopAreaSelection();
      return;
    }
    if (ocrMenu || performance.now() - ocrMenuClosedAt < 400) {
      ocrMenu = null;
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    ocrMenu = { x: rect.left, y: rect.top - 4 };
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

  // The zoom percentage opens a menu of common levels and the fit options.
  const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200, 250];

  let zoomMenu: { x: number; y: number } | null = $state(null);
  const zoomMenuItems: ContextMenuItem[] = $derived([
    ...ZOOM_LEVELS.map((level) => ({
      label: `${level}%`,
      icon: level === zoomPercent ? MENU_ICONS.check : undefined,
      onSelect: () => editorStore.setRenderScale((level / 100) * DEFAULT_RENDER_SCALE),
    })),
    {
      label: 'Fit page width',
      icon: MENU_ICONS.fitWidth,
      separatorBefore: true,
      disabled: fitting,
      onSelect: () => fitTo('width'),
    },
    { label: 'Fit whole page', icon: MENU_ICONS.fitPage, disabled: fitting, onSelect: () => fitTo('page') },
  ]);

  // Same reopening guard as the Recognize text menu.
  let zoomMenuClosedAt = 0;

  function closeZoomMenu() {
    zoomMenu = null;
    zoomMenuClosedAt = performance.now();
  }

  function toggleZoomMenu(e: MouseEvent) {
    if (zoomMenu || performance.now() - zoomMenuClosedAt < 400) {
      zoomMenu = null;
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    zoomMenu = { x: rect.left, y: rect.top - 4 };
  }

  // A few seconds after the pointer leaves, the toolbar fades so it hides
  // less of the page; hovering it or tabbing into it brings it back (a
  // button keeps focus after a click, so only keyboard focus counts). It
  // stays solid while one of its menus is open.
  const FADE_DELAY = 3000;
  let hovered = $state(false);
  let focused = $state(false);
  let faded = $state(false);

  $effect(() => {
    if (hovered || focused || zoomMenu || ocrMenu) {
      faded = false;
      return;
    }
    const timer = setTimeout(() => (faded = true), FADE_DELAY);
    return () => clearTimeout(timer);
  });
</script>

<!-- Placed by EditorView, which keeps it still when the tool panel opens. -->
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
          {result.label ?? 'Screenshot'}
          {result.copied ? 'copied to clipboard' : 'ready'}
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

  <div
    role="group"
    aria-label="Editing tools"
    class="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-full border
      border-neutral-200 bg-white/90 px-2 py-1.5 shadow-lg backdrop-blur transition-opacity duration-500
      dark:border-neutral-800 dark:bg-neutral-900/90"
    class:opacity-40={faded}
    onpointerenter={() => (hovered = true)}
    onpointerleave={() => (hovered = false)}
    onfocusin={(e) => (focused = (e.target as Element).matches(':focus-visible'))}
    onfocusout={(e) => (focused = e.currentTarget.contains(e.relatedTarget as Node | null))}
  >
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
        use:tooltip={'Zoom out (Ctrl+−, or Ctrl+scroll)'}
        class={iconButtonClass}
        onclick={() => editorStore.zoomOut()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
          <path stroke-linecap="round" d="M5 12h14" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Zoom level"
        aria-haspopup="menu"
        aria-expanded={zoomMenu !== null}
        use:tooltip={'Zoom level and fit (Ctrl+0: 100%)'}
        class="w-12 rounded-full px-1 py-0.5 text-center text-xs tabular-nums text-neutral-500 hover:bg-neutral-100
          dark:text-neutral-400 dark:hover:bg-neutral-800"
        onclick={toggleZoomMenu}
      >
        {zoomPercent}%
      </button>
      {#if zoomMenu}
        <ContextMenu x={zoomMenu.x} y={zoomMenu.y} items={zoomMenuItems} onClose={closeZoomMenu} above />
      {/if}
      <button
        type="button"
        aria-label="Zoom in"
        use:tooltip={'Zoom in (Ctrl+=, or Ctrl+scroll)'}
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

    <!-- Basics -->
    <ToolButton
      label="Move"
      tip={'Move: drag existing signatures, text, or redactions around (default)'}
      active={moveModeActive}
      activeClass="border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
      onclick={activateMoveMode}
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M9 11.5V6a1.5 1.5 0 0 1 3 0v5M12 11.5V5a1.5 1.5 0 0 1 3 0v6.5M15 11.5V7a1.5 1.5 0 0 1 3 0v7c0 3.31-2.69 6-6 6h-1c-2 0-3-.5-4-2l-2.7-3.6a1.4 1.4 0 0 1 .3-1.9 1.4 1.4 0 0 1 1.8.1L9 15"
      />
    </ToolButton>

    <ToolButton
      label="Select"
      tip={'Select: drag over the document to select and copy its real text'}
      active={$activeTool === 'select'}
      activeClass="border-emerald-600 bg-emerald-600 text-white"
      onclick={() => toggleTool('select')}
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M8 5h8M12 5v14M8 19h8" />
    </ToolButton>

    <div aria-hidden="true" class={dividerClass}></div>

    <!-- Sign and fill -->
    <ToolButton
      label="Signature"
      tip={'Signature: open the signature panel to place, manage, and watermark signatures'}
      active={$activeTool === 'signature'}
      activeClass="border-indigo-600 bg-indigo-600 text-white"
      onclick={() => toggleTool('signature')}
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M4 20l4-1 10-10a2.121 2.121 0 0 0-3-3L5 16l-1 4z" />
      <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l3 3" />
    </ToolButton>

    <ToolButton
      label="Add Text"
      tip={'Add Text: click on the document to place a text box'}
      active={$activeTool === 'text'}
      activeClass="border-blue-600 bg-blue-600 text-white"
      onclick={() => toggleTool('text')}
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M5 6h14M12 6v12" />
    </ToolButton>

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

    <div aria-hidden="true" class={dividerClass}></div>

    <!-- Mark up -->
    <ToolButton
      label="Comment"
      tip={'Comment: click on the document to leave a sticky note'}
      active={$activeTool === 'comment'}
      activeClass="border-amber-500 bg-amber-500 text-white"
      onclick={() => toggleTool('comment')}
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M4 5h16v11H8l-4 4V5Z" />
    </ToolButton>

    <ToolButton
      label="Shapes"
      tip={'Shapes: drag on the page to draw a shape, line, or arrow'}
      active={$activeTool === 'shapes'}
      activeClass="border-fuchsia-600 bg-fuchsia-600 text-white"
      onclick={() => toggleTool('shapes')}
    >
      <rect x="3" y="11" width="10" height="10" rx="1" />
      <circle cx="16" cy="8" r="5" />
    </ToolButton>

    <div aria-hidden="true" class={dividerClass}></div>

    <!-- Protect -->
    <ToolButton
      label="Redact"
      tip={'Redact: draw a box to permanently remove content from the exported PDF'}
      active={$activeTool === 'redact'}
      activeClass="border-red-600 bg-red-600 text-white"
      onclick={() => toggleTool('redact')}
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path stroke-linecap="round" d="M8 12h8" />
    </ToolButton>

    <ToolButton
      label="Watermark"
      tip={'Watermark: stamp a word or a picture across every page'}
      active={$activeTool === 'watermark'}
      activeClass="border-amber-600 bg-amber-600 text-white"
      onclick={() => toggleTool('watermark')}
    >
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path stroke-linecap="round" stroke-linejoin="round" d="M8.5 15.5l7-7M8.5 11.5l3-3M12.5 15.5l3-3" />
    </ToolButton>

    <div aria-hidden="true" class={dividerClass}></div>

    <!-- Pages -->
    <ToolButton
      label="Page numbers, header & footer"
      tip={'Page numbers, header & footer: number the pages, or add text along their top and bottom'}
      active={$activeTool === 'pageNumbers'}
      activeClass="border-teal-600 bg-teal-600 text-white"
      onclick={() => toggleTool('pageNumbers')}
    >
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path stroke-linecap="round" stroke-linejoin="round" d="M11 14.5l1.5-1V18M10.5 18h3.5" />
    </ToolButton>

    <ToolButton
      label="Crop"
      tip={'Crop: drag on a page to frame the part to keep'}
      active={$activeTool === 'crop'}
      activeClass="border-orange-600 bg-orange-600 text-white"
      onclick={() => toggleTool('crop')}
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" />
    </ToolButton>

    <ToolButton
      label="Screenshot"
      tip={'Screenshot: click a page to capture all of it, or drag to capture an area'}
      active={$activeTool === 'screenshot'}
      activeClass="border-sky-600 bg-sky-600 text-white"
      onclick={() => toggleTool('screenshot')}
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3" />
    </ToolButton>

    <ToolButton
      label="Recognize text"
      tip={'Recognize text (OCR): make scanned text searchable and copyable, on this page, every page, or an area'}
      active={$ocrAreaMode}
      activeClass="border-cyan-600 bg-cyan-600 text-white"
      disabled={isOcrRunning($ocrStatus)}
      menuOpen={ocrMenu !== null}
      onclick={toggleOcrMenu}
    >
      <path stroke-linecap="round" stroke-linejoin="round" d={MENU_ICONS.recognize} />
    </ToolButton>
    {#if ocrMenu}
      <ContextMenu x={ocrMenu.x} y={ocrMenu.y} items={ocrMenuItems} onClose={closeOcrMenu} above />
    {/if}
  </div>
</div>
