<script lang="ts">
  import ThemeToggle from './ThemeToggle.svelte';
  import FullscreenToggle from './FullscreenToggle.svelte';
  import StartOverButton from './StartOverButton.svelte';
  import DocumentTabs from './DocumentTabs.svelte';
  import ExportButton from './ExportButton.svelte';
  import DriveButton from './DriveButton.svelte';
  import { editorStore } from '../stores/editor';
  import { openSearch } from '../stores/search';
  import { isFileAccepted, dedupeFiles, formatFileSize, MAX_PDF_SIZE_BYTES } from '../lib/utils/fileValidation';
  import { DOCUMENT_ACCEPT, toPdfFiles } from '../lib/pdf/importFiles';

  const findShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘F' : 'Ctrl+F';

  let addPdfsError: string | null = $state(null);
  let errorTimeout: ReturnType<typeof setTimeout> | undefined;

  function showError(message: string | null) {
    clearTimeout(errorTimeout);
    addPdfsError = message;
    if (message) errorTimeout = setTimeout(() => (addPdfsError = null), 4000);
  }

  async function onAddDocument(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    await addFiles(files);
  }

  async function addFiles(files: File[]) {
    const typeOk = files.filter((f) => isFileAccepted(f, DOCUMENT_ACCEPT));
    const tooLarge = typeOk.filter((f) => f.size > MAX_PDF_SIZE_BYTES);
    const sized = typeOk.filter((f) => f.size <= MAX_PDF_SIZE_BYTES);
    const { pdfs, messages } = await toPdfFiles(sized);
    const { unique, duplicates } = dedupeFiles(
      pdfs,
      $editorStore.documents.map((d) => d.file),
    );


    if (tooLarge.length > 0) {
      messages.push(`Skipped (over ${formatFileSize(MAX_PDF_SIZE_BYTES)}): ${tooLarge.map((f) => f.name).join(', ')}`);
    }
    if (duplicates.length > 0) {
      messages.push(`Already added: ${duplicates.map((f) => f.name).join(', ')}`);
    }
    showError(messages.length > 0 ? messages.join(' ') : null);

    if (unique.length > 0) editorStore.addPdfs(unique);
  }
</script>

<!-- z-[70]: the Save menu drops down from here and has to sit above the page's
     own overlays (e.g. the screenshot tool's z-[60] cover). -->
<header class="sticky top-0 z-[70] flex flex-col border-b border-neutral-200 bg-white/90
  backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
  <div class="flex items-end gap-4 px-4 pb-0 pt-2">
    <span class="shrink-0 pb-2 text-lg font-bold tracking-tight">RayPDF</span>

    <div class="shrink-0 pb-2">
      <StartOverButton variant="icon" />
    </div>

    <div class="flex min-w-0 flex-1 items-end gap-1 self-stretch overflow-x-auto">
      <DocumentTabs />

      <label
        class="flex shrink-0 cursor-pointer items-center justify-center rounded-t-lg border border-b-0
          border-neutral-200 px-3 py-1.5 text-neutral-500 transition-colors hover:bg-neutral-100/60
          hover:text-neutral-800 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/60
          dark:hover:text-neutral-100"
        aria-label="Add document"
        title="Add another PDF or Markdown file"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
        </svg>
        <input type="file" accept={DOCUMENT_ACCEPT} multiple class="hidden" onchange={onAddDocument} />
      </label>
      <DriveButton variant="icon" onFiles={addFiles} onError={showError} />
    </div>

    <div class="ml-auto flex shrink-0 items-center gap-1 pb-2">
      <button
        type="button"
        aria-label="Find in document"
        title="Find in document ({findShortcut})"
        class="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 transition-colors
          hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800
          dark:hover:text-neutral-100"
        onclick={openSearch}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M21 21l-4.3-4.3" />
        </svg>
      </button>
      <FullscreenToggle />
      <ThemeToggle />
      <div class="ml-2">
        <ExportButton />
      </div>
    </div>
  </div>

  {#if addPdfsError}
    <p class="border-t border-neutral-200 px-4 py-1 text-xs text-red-600 dark:border-neutral-800 dark:text-red-400">
      {addPdfsError}
    </p>
  {/if}
</header>
