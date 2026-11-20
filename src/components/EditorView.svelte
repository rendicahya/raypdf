<script lang="ts">
  // The editor, loaded by App only once documents are open, so the front page
  // doesn't download the editor's code (and the libraries it pulls in).
  import PDFPages from './PDFPages.svelte';
  import ToolPanel from './ToolPanel.svelte';
  import PageSidebar from './PageSidebar.svelte';
  import FloatingControls from './FloatingControls.svelte';
  import Toolbar from './Toolbar.svelte';
  import SearchBar from './SearchBar.svelte';
  import OcrStatus from './OcrStatus.svelte';
  import MarkdownExport from './MarkdownExport.svelte';
  import { markdownExport } from '../stores/markdownExport';
  import { search, openSearch, closeSearch } from '../stores/search';
  import { editorStore, activeDocument, DEFAULT_RENDER_SCALE } from '../stores/editor';
  import { pageSidebarOpen, pageSidebarWidth, togglePageSidebar } from '../stores/layout';
  import { redactMode } from '../stores/redact';
  import { textToolMode } from '../stores/textTool';
  import { screenshotToolMode } from '../stores/screenshotTool';
  import { textSelectMode } from '../stores/textSelect';
  import { signatureToolMode } from '../stores/signatureTool';
  import { pageNumbersToolMode } from '../stores/pageNumbersTool';
  import { pageWatermarkToolMode } from '../stores/pageWatermarkTool';
  import { shapeToolMode } from '../stores/shapeTool';
  import { cropToolMode } from '../stores/cropTool';
  import { ocrAreaMode, stopAreaSelection } from '../stores/ocr';
  import { activePanelTool, imagePropertiesId, shownPanelTool, toolPanelOpen, TOOL_PANEL_WIDTH } from '../stores/toolPanel';
  import { tooltip } from '../lib/utils/tooltip';

  const sidebarShortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘B' : 'Ctrl+B';

  const active = $derived($activeDocument);

  // The bottom toolbar is centred on the whole area right of the page
  // sidebar, tool panel included, so opening or closing the panel doesn't
  // move it. Only when the panel is open and the toolbar is too wide to stay
  // centred without running into it does it slide left, just enough.
  const TOOLBAR_GUTTER = 16;
  let editorAreaWidth = $state(0);
  let toolbarWidth = $state(0);
  const toolbarAreaLeft = $derived($pageSidebarOpen ? $pageSidebarWidth : 0);
  const toolbarAreaRight = $derived(editorAreaWidth - ($shownPanelTool ? TOOL_PANEL_WIDTH : 0));
  const toolbarMaxWidth = $derived(Math.max(0, toolbarAreaRight - toolbarAreaLeft - 2 * TOOLBAR_GUTTER));
  const toolbarLeft = $derived(
    Math.max(
      toolbarAreaLeft + TOOLBAR_GUTTER,
      Math.min(
        (toolbarAreaLeft + editorAreaWidth - toolbarWidth) / 2,
        toolbarAreaRight - TOOLBAR_GUTTER - toolbarWidth,
      ),
    ),
  );

  // Escape backs out of whichever click-driven canvas mode is active, in this order.
  const escapable: { isOn: () => boolean; turnOff: () => void }[] = [
    { isOn: () => $redactMode, turnOff: () => redactMode.set(false) },
    { isOn: () => $textToolMode, turnOff: () => textToolMode.set(false) },
    { isOn: () => $textSelectMode, turnOff: () => textSelectMode.set(false) },
    { isOn: () => $screenshotToolMode, turnOff: () => screenshotToolMode.set(false) },
    { isOn: () => $signatureToolMode, turnOff: () => signatureToolMode.set(false) },
    { isOn: () => $pageNumbersToolMode, turnOff: () => pageNumbersToolMode.set(false) },
    { isOn: () => $pageWatermarkToolMode, turnOff: () => pageWatermarkToolMode.set(false) },
    { isOn: () => $shapeToolMode, turnOff: () => shapeToolMode.set(false) },
    { isOn: () => $cropToolMode, turnOff: () => cropToolMode.set(false) },
    { isOn: () => !!$imagePropertiesId, turnOff: () => imagePropertiesId.set(null) },
    { isOn: () => $ocrAreaMode, turnOff: stopAreaSelection },
    { isOn: () => $search.open, turnOff: closeSearch },
  ];

  // Editor keyboard shortcuts. All but Ctrl+F and zoom bail out while a form
  // control has focus, so native input/select behavior (e.g. arrow keys
  // inside the page dropdown) is never overridden.
  //  - Ctrl/Cmd+B: toggle the page sidebar (VS Code convention).
  //  - Ctrl/Cmd+Z: undo. Ctrl/Cmd+Shift+Z (or Ctrl+Y): redo.
  //  - Left/Right: previous/next page.
  //  - Ctrl/Cmd+Left/Right: previous/next document.
  //  - Ctrl/Cmd+P (ExportButton): print the edited PDF.
  function onGlobalKeydown(e: KeyboardEvent) {
    // Ctrl/Cmd+F: find in the document instead of the browser's own find,
    // which can't see text drawn on the PDF canvas. Works from any field.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openSearch();
      return;
    }

    // Ctrl/Cmd with +, -, or 0 zooms the document instead of the browser
    // (as Ctrl+wheel does in PDFPages).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ['=', '+', '-', '0'].includes(e.key)) {
      e.preventDefault();
      if (e.key === '-') editorStore.zoomOut();
      else if (e.key === '0') editorStore.setRenderScale(DEFAULT_RENDER_SCALE);
      else editorStore.zoomIn();
      return;
    }

    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

    const mod = e.ctrlKey || e.metaKey;

    // While actually typing into a text box, PDFViewer's own Escape handler
    // on the textarea runs first and stops this event from ever reaching
    // here (it commits the text rather than just dropping the mode): this
    // only fires for "mode is on but nothing's being edited right now".
    if (e.key === 'Escape' && !mod && !e.shiftKey && !e.altKey) {
      const mode = escapable.find((m) => m.isOn());
      if (mode) {
        e.preventDefault();
        mode.turnOff();
        return;
      }
    }

    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      togglePageSidebar();
      return;
    }

    if (mod && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) editorStore.redo();
      else editorStore.undo();
      return;
    }

    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      editorStore.redo();
      return;
    }

    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (mod) {
        if (e.key === 'ArrowLeft') editorStore.prevDocument();
        else editorStore.nextDocument();
      } else {
        if (e.key === 'ArrowLeft') editorStore.prevPage();
        else editorStore.nextPage();
      }
    }
  }
</script>

<svelte:window onkeydown={onGlobalKeydown} />

{#if $markdownExport}
  <MarkdownExport initialPages={$markdownExport.pages} />
{/if}

{#if active}
  <Toolbar />
  <div class="relative flex flex-1 overflow-hidden" bind:clientWidth={editorAreaWidth}>
    <PageSidebar />
    <button
      type="button"
      aria-label={$pageSidebarOpen ? 'Hide page panel' : 'Show page panel'}
      title={`${$pageSidebarOpen ? 'Hide page panel' : 'Show page panel'} (${sidebarShortcutLabel})`}
      class="absolute top-1/2 z-20 flex h-10 w-4 -translate-y-1/2 items-center justify-center rounded-r-md
        border border-l-0 border-neutral-200 bg-white text-neutral-400 shadow-sm transition-[left]
        hover:bg-neutral-100 hover:text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900
        dark:text-neutral-500 dark:hover:bg-neutral-800"
      style:left={$pageSidebarOpen ? `${$pageSidebarWidth}px` : '0'}
      onclick={togglePageSidebar}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        class="h-3.5 w-3.5 transition-transform"
        class:rotate-180={!$pageSidebarOpen}
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 6l-6 6 6 6" />
      </svg>
    </button>
    <div class="relative flex flex-1 flex-col overflow-hidden">
      <SearchBar />
      <OcrStatus />
      <div class="flex-1 overflow-auto px-6 py-8" data-pdf-scroll-container>
        {#key active.id}
          <PDFPages />
        {/key}
      </div>
    </div>
    <!-- The active tool's options (stores/toolPanel.ts). -->
    {#if $shownPanelTool}
      <aside data-tool-panel class="flex shrink-0 flex-col border-l border-neutral-200 bg-white
        dark:border-neutral-800 dark:bg-neutral-950" style:width="{TOOL_PANEL_WIDTH}px">
        <div class="flex-1 overflow-y-auto p-4">
          <ToolPanel tool={$shownPanelTool} />
        </div>
      </aside>
    {/if}
    {#if $activePanelTool && $activePanelTool !== 'signature' && $activePanelTool !== 'pageNumbers' && $activePanelTool !== 'watermark' && $activePanelTool !== 'image'}
      <button
        type="button"
        aria-label={$toolPanelOpen ? 'Hide tool options' : 'Show tool options'}
        use:tooltip={$toolPanelOpen ? 'Hide tool options' : 'Show tool options'}
        class="absolute top-1/2 z-20 flex h-10 w-4 -translate-y-1/2 items-center justify-center rounded-l-md
          border border-r-0 border-neutral-200 bg-white text-neutral-400 shadow-sm hover:bg-neutral-100
          hover:text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500
          dark:hover:bg-neutral-800"
        style:right={$toolPanelOpen ? `${TOOL_PANEL_WIDTH}px` : '0'}
        onclick={() => toolPanelOpen.update((open) => !open)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          class="h-3.5 w-3.5 transition-transform"
          class:rotate-180={!$toolPanelOpen}
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6" />
        </svg>
      </button>
    {/if}
    <!-- Positioned by toolbarLeft (see the script): it doesn't move when the tool panel opens. -->
    <div
      class="pointer-events-none absolute bottom-4 z-20 w-max"
      style:left="{toolbarLeft}px"
      style:max-width="{toolbarMaxWidth}px"
      bind:offsetWidth={toolbarWidth}
    >
      <FloatingControls />
    </div>
  </div>
{/if}
