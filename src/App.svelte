<script lang="ts">
  import UploadCard from './components/UploadCard.svelte';
  import DocumentThumbnail from './components/DocumentThumbnail.svelte';
  import PDFViewer from './components/PDFViewer.svelte';
  import ToolPanel from './components/ToolPanel.svelte';
  import PageSidebar from './components/PageSidebar.svelte';
  import FloatingControls from './components/FloatingControls.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import ThemeToggle from './components/ThemeToggle.svelte';
  import UpdateToast from './components/UpdateToast.svelte';
  import VerifyResults from './components/VerifyResults.svelte';
  import FeatureGrid from './components/FeatureGrid.svelte';
  import Faq from './components/Faq.svelte';
  import SearchBar from './components/SearchBar.svelte';
  import { search, openSearch, closeSearch } from './stores/search';
  import { editorStore, activeDocument } from './stores/editor';
  import { theme } from './stores/theme';
  import { pageSidebarOpen, pageSidebarWidth, togglePageSidebar } from './stores/layout';
  import { redactMode } from './stores/redact';
  import { textToolMode } from './stores/textTool';
  import { zoomToolMode } from './stores/zoomTool';
  import { screenshotToolMode } from './stores/screenshotTool';
  import { textSelectMode } from './stores/textSelect';
  import { signatureToolMode } from './stores/signatureTool';
  import { activePanelTool, shownPanelTool, toolPanelOpen, TOOL_PANEL_WIDTH } from './stores/toolPanel';
  import { tooltip } from './lib/utils/tooltip';
  import { isFileAccepted, formatFileSize, dedupeFiles, MAX_PDF_SIZE_BYTES } from './lib/utils/fileValidation';
  import { clearCachedPdf } from './lib/pdf/docCache';

  const PDF_ACCEPT = 'application/pdf,.pdf';

  const sidebarShortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘B' : 'Ctrl+B';

  let addPdfsError: string | null = $state(null);
  let isPageDragging = $state(false);
  let pageDragDepth = 0;

  const editor = $derived($editorStore);
  const active = $derived($activeDocument);

  // Step 2 asks what to do with the added PDFs rather than jumping straight
  // into the editor, so the user can review the batch (remove one, add more)
  // and pick between the editor ('sign') and verifying (checked in place).
  let choice: 'sign' | 'verify' | null = $state(null);

  $effect(() => {
    if (editor.documents.length === 0) choice = null;
  });

  // Clear the drag overlay when PDFs are added (including via drop on UploadCard).
  $effect(() => {
    editor.documents.length;
    pageDragDepth = 0;
    isPageDragging = false;
  });

  const readyForEditor = $derived(editor.documents.length > 0 && choice === 'sign');

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

  function onPdfFiles(files: File[]) {
    const { unique } = dedupeFiles(files);
    editorStore.loadPdfs(unique);
  }

  function onAddMorePdfs(e: Event) {
    const input = e.target as HTMLInputElement;
    const typeOk = Array.from(input.files ?? []).filter((f) => isFileAccepted(f, PDF_ACCEPT));
    input.value = '';

    const tooLarge = typeOk.filter((f) => f.size > MAX_PDF_SIZE_BYTES);
    const sized = typeOk.filter((f) => f.size <= MAX_PDF_SIZE_BYTES);
    const { unique, duplicates } = dedupeFiles(
      sized,
      editor.documents.map((d) => d.file),
    );

    const messages: string[] = [];
    if (tooLarge.length > 0) {
      messages.push(`Skipped (over ${formatFileSize(MAX_PDF_SIZE_BYTES)}): ${tooLarge.map((f) => f.name).join(', ')}`);
    }
    if (duplicates.length > 0) {
      messages.push(`Already added: ${duplicates.map((f) => f.name).join(', ')}`);
    }
    addPdfsError = messages.length > 0 ? messages.join(' ') : null;

    if (unique.length > 0) editorStore.addPdfs(unique);
  }

  function removeDocument(id: string) {
    clearCachedPdf(id);
    editorStore.removeDocument(id);
  }

  function removeAllDocuments() {
    editor.documents.forEach((doc) => clearCachedPdf(doc.id));
    editorStore.reset();
    addPdfsError = null;
  }

  // Lets PDFs be dropped anywhere on the pre-editor screens, not just onto
  // the upload card — dragenter/dragleave bubble from every descendant, so a
  // depth counter is needed to know when the pointer has actually left the
  // page rather than just crossed into a child element.
  function isFileDrag(e: DragEvent): boolean {
    return !readyForEditor && !!e.dataTransfer?.types.includes('Files');
  }

  function onPageDragEnter(e: DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    pageDragDepth++;
    isPageDragging = true;
  }

  function onPageDragOver(e: DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
  }

  function onPageDragLeave(e: DragEvent) {
    if (!isFileDrag(e)) return;
    pageDragDepth = Math.max(0, pageDragDepth - 1);
    if (pageDragDepth === 0) isPageDragging = false;
  }

  function onPageDrop(e: DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    pageDragDepth = 0;
    isPageDragging = false;

    const dropped = Array.from(e.dataTransfer?.files ?? []);
    const typeOk = dropped.filter((f) => isFileAccepted(f, PDF_ACCEPT));
    if (typeOk.length === 0) {
      addPdfsError = 'Please drop PDF files.';
      return;
    }

    const tooLarge = typeOk.filter((f) => f.size > MAX_PDF_SIZE_BYTES);
    const sized = typeOk.filter((f) => f.size <= MAX_PDF_SIZE_BYTES);
    const { unique, duplicates } = dedupeFiles(
      sized,
      editor.documents.map((d) => d.file),
    );

    const messages: string[] = [];
    if (tooLarge.length > 0) {
      messages.push(`Skipped (over ${formatFileSize(MAX_PDF_SIZE_BYTES)}): ${tooLarge.map((f) => f.name).join(', ')}`);
    }
    if (duplicates.length > 0) {
      messages.push(`Already added: ${duplicates.map((f) => f.name).join(', ')}`);
    }
    addPdfsError = messages.length > 0 ? messages.join(' ') : null;

    if (unique.length === 0) return;
    if (editor.documents.length === 0) onPdfFiles(unique);
    else editorStore.addPdfs(unique);
  }

  // Reflect the chosen theme on <html> so Tailwind's `dark:` variants apply.
  $effect(() => {
    document.documentElement.classList.toggle('dark', $theme === 'dark');
  });

  // Editor-only keyboard shortcuts — all bail out while a form control has
  // focus, so native input/select behavior (e.g. arrow keys inside the page
  // dropdown) is never overridden.
  //  - Ctrl/Cmd+B: toggle the page sidebar (VS Code convention).
  //  - Ctrl/Cmd+Z: undo. Ctrl/Cmd+Shift+Z (or Ctrl+Y): redo.
  //  - Left/Right: previous/next page.
  //  - Ctrl/Cmd+Left/Right: previous/next document.
  function onGlobalKeydown(e: KeyboardEvent) {
    if (!readyForEditor) return;

    // Ctrl/Cmd+F: find in the document instead of the browser's own find,
    // which can't see text drawn on the PDF canvas. Works from any field.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openSearch();
      return;
    }

    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

    const mod = e.ctrlKey || e.metaKey;

    // Escape backs out of whichever click-driven canvas mode is active.
    // While actually typing into a text box, PDFViewer's own Escape handler
    // on the textarea runs first and stops this event from ever reaching
    // here (it commits the text rather than just dropping the mode) — this
    // only fires for "mode is on but nothing's being edited right now".
    if (e.key === 'Escape' && !mod && !e.shiftKey && !e.altKey) {
      if ($redactMode) {
        e.preventDefault();
        redactMode.set(false);
        return;
      }
      if ($textToolMode) {
        e.preventDefault();
        textToolMode.set(false);
        return;
      }
      if ($zoomToolMode) {
        e.preventDefault();
        zoomToolMode.set(false);
        return;
      }
      if ($textSelectMode) {
        e.preventDefault();
        textSelectMode.set(false);
        return;
      }
      if ($screenshotToolMode) {
        e.preventDefault();
        screenshotToolMode.set(false);
        return;
      }
      if ($signatureToolMode) {
        e.preventDefault();
        signatureToolMode.set(false);
        return;
      }
      if ($search.open) {
        e.preventDefault();
        closeSearch();
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

<main
  class="min-h-screen"
  class:flex={readyForEditor}
  class:h-screen={readyForEditor}
  class:flex-col={readyForEditor}
  ondragenter={onPageDragEnter}
  ondragover={onPageDragOver}
  ondragleave={onPageDragLeave}
  ondrop={onPageDrop}
>
  <UpdateToast />

  {#if isPageDragging}
    <div class="pointer-events-none fixed inset-4 z-50 flex items-center justify-center rounded-3xl border-4
      border-dashed border-blue-500 bg-blue-50/80 backdrop-blur-sm dark:bg-blue-950/80">
      <span class="text-xl font-medium text-blue-700 dark:text-blue-300">Drop your PDF anywhere</span>
    </div>
  {/if}
  {#if !readyForEditor}
    <div class="fixed right-4 top-4 z-10">
      <ThemeToggle />
    </div>

    <!-- Purely decorative glow behind the hero — sits below everything else. -->
    <div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div class="absolute left-1/2 top-[-12rem] h-[34rem] w-[60rem] -translate-x-1/2 rounded-full
        bg-blue-200/50 blur-3xl dark:bg-blue-900/25"></div>
    </div>

    <div class="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center gap-8 px-6 py-16">
      <div class="text-center">
        <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600
          text-white shadow-lg shadow-blue-600/25">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-7 w-7">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M4 20l4-1 10-10a2.121 2.121 0 0 0-3-3L5 16l-1 4z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l3 3" />
          </svg>
        </div>
        <h1 class="text-4xl font-bold tracking-tight sm:text-5xl">RayPDF</h1>
        <p class="mx-auto mt-3 max-w-md text-neutral-500 dark:text-neutral-400">
          Sign, fill, mark up, and redact PDFs, entirely in your browser.
        </p>
        <div class="mt-4 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50
          px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950
          dark:text-emerald-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          100% local: your files never leave this device
        </div>
      </div>

      {#if editor.documents.length === 0}
        <!-- Step 1: add PDFs. -->
        <div class="w-full max-w-md">
          <UploadCard
            title="Add PDF"
            subtitle="Drag & drop or click to browse. You can select multiple."
            accept={PDF_ACCEPT}
            multiple
            errorMessage="Please choose PDF files."
            maxSizeBytes={MAX_PDF_SIZE_BYTES}
            onFiles={onPdfFiles}
          />
        </div>
        <div class="mt-4 w-full">
          <FeatureGrid />
        </div>
        <div class="w-full max-w-3xl">
          <Faq />
        </div>
      {:else if choice === 'verify'}
        <!-- Verify: every added PDF is checked in place, no editor needed. -->
        <div class="flex w-full max-w-md flex-col gap-4">
          <VerifyResults documents={editor.documents} />
          <div class="flex items-center justify-between text-sm font-medium">
            <button
              type="button"
              class="text-neutral-500 hover:text-neutral-700 hover:underline dark:text-neutral-400
                dark:hover:text-neutral-200"
              onclick={() => (choice = null)}
            >
              ← Back
            </button>
            <button
              type="button"
              class="text-blue-600 hover:underline dark:text-blue-400"
              onclick={() => (choice = 'sign')}
            >
              Open in editor instead →
            </button>
          </div>
        </div>
      {:else}
        <!-- Step 2: PDFs are in. Review the batch, then choose to sign
             (the editor, where signing, redacting, etc. are all optional)
             or to verify. -->
        <div class="flex w-full max-w-md flex-col gap-6">
          <div class="flex max-h-[60vh] w-full flex-col gap-2 rounded-2xl border border-neutral-200 bg-neutral-50
            p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">
                {editor.documents.length} PDF{editor.documents.length > 1 ? 's' : ''} added
              </span>
              <div class="flex items-center gap-3 text-xs font-medium">
                <label class="cursor-pointer text-blue-600 hover:underline dark:text-blue-400">
                  + Add more
                  <input type="file" accept={PDF_ACCEPT} multiple class="hidden" onchange={onAddMorePdfs} />
                </label>
                <button
                  type="button"
                  class="text-neutral-400 hover:text-red-500 hover:underline"
                  onclick={removeAllDocuments}
                >
                  Remove all
                </button>
              </div>
            </div>
            {#if addPdfsError}
              <p class="text-xs text-red-600 dark:text-red-400">{addPdfsError}</p>
            {/if}
            <ul class="flex-1 space-y-1 overflow-y-auto text-sm">
              {#each editor.documents as doc (doc.id)}
                <li class="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5
                  dark:bg-neutral-800">
                  <DocumentThumbnail id={doc.id} file={doc.file} />
                  <span class="min-w-0 flex-1 truncate">{doc.file.name}</span>
                  <span class="shrink-0 text-xs text-neutral-400">
                    {doc.pageCount} page{doc.pageCount > 1 ? 's' : ''}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove {doc.file.name}"
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg leading-none
                      text-neutral-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/50"
                    onclick={() => removeDocument(doc.id)}
                  >
                    ×
                  </button>
                </li>
              {/each}
            </ul>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <button
              type="button"
              class="flex flex-col items-center gap-1 rounded-2xl bg-blue-600 px-4 py-4 text-white shadow-sm
                shadow-blue-600/20 transition-colors hover:bg-blue-700"
              onclick={() => (choice = 'sign')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-6 w-6">
                <path stroke-linecap="round" stroke-linejoin="round"
                  d="M4 20l4-1 10-10a2.121 2.121 0 0 0-3-3L5 16l-1 4z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l3 3" />
              </svg>
              <span class="font-semibold">Open in editor</span>
              <span class="text-xs text-blue-100">Sign, fill, mark up, or redact</span>
            </button>
            <button
              type="button"
              class="flex flex-col items-center gap-1 rounded-2xl border border-neutral-200 bg-white px-4 py-4
                shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-neutral-800
                dark:bg-neutral-900 dark:hover:border-blue-800 dark:hover:bg-blue-950/40"
              onclick={() => (choice = 'verify')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                class="h-6 w-6 text-emerald-600 dark:text-emerald-400">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.5 12l2.5 2.5 4.5-5" />
              </svg>
              <span class="font-semibold">Verify</span>
              <span class="text-xs text-neutral-500 dark:text-neutral-400">Check for a RayPDF record</span>
            </button>
          </div>
        </div>
      {/if}
    </div>
  {:else if active}
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
        <div class="flex-1 overflow-auto px-6 py-8" data-pdf-scroll-container>
          {#key active.id}
            <PDFViewer />
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
      {#if $activePanelTool && $activePanelTool !== 'signature'}
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
</main>
