<script lang="ts">
  import { untrack } from 'svelte';
  import { editorStore, activeDocument } from '../stores/editor';
  import { signatureStore } from '../stores/signature';
  import { currentWatermarkOptions } from '../stores/watermark';
  import { stripEmbeddedScripts } from '../stores/exportOptions';
  import { closeMarkdownExport, markdownFormatting } from '../stores/markdownExport';
  import { exportSignedPdf } from '../lib/pdf/export';
  import {
    readMarkdownSource,
    chooseBlocks,
    displayRuns,
    writeMarkdown,
    downloadMarkdown,
    type MarkdownSource,
  } from '../lib/pdf/markdown';
  import { parsePageRange, formatPageRange } from '../lib/utils/pageRange';
  import { tooltip } from '../lib/utils/tooltip';

  interface Props {
    /** The pages picked in the thumbnails, or null for every page. */
    initialPages: number[] | null;
  }

  let { initialPages }: Props = $props();

  // The document as it was when the preview opened; switching tabs closes it.
  const doc = untrack(() => $activeDocument);
  $effect(() => {
    if ($activeDocument?.id !== doc?.id) closeMarkdownExport();
  });

  const pageCount = doc?.pageCount ?? 0;
  let allPages = $state(untrack(() => initialPages === null || initialPages.length === pageCount));
  let rangeText = $state(untrack(() => formatPageRange(initialPages ?? [])));
  let view: 'preview' | 'markdown' = $state('preview');

  let source: MarkdownSource | null = $state(null);
  let progress = $state('Preparing…');
  let error: string | null = $state(null);
  let copied = $state(false);
  let copiedTimeout: ReturnType<typeof setTimeout> | undefined;

  const chosenPages = $derived(
    allPages ? Array.from({ length: pageCount }, (_, i) => i + 1) : parsePageRange(rangeText, pageCount),
  );
  const blocks = $derived(source && chosenPages ? chooseBlocks(source, chosenPages) : []);
  const markdown = $derived(writeMarkdown(blocks, { formatting: $markdownFormatting }));
  const words = $derived(markdown.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length);

  // Converted from the PDF as it would be saved, so redacted text is gone and
  // added text and form answers are in. Page numbers, headers and footers,
  // and the page watermark are left off: they aren't the document's text.
  async function load() {
    if (!doc) return;
    try {
      const placements = $signatureStore.signature ? doc.placedSignatures : [];
      const bytes = await exportSignedPdf({
        pdfFile: doc.file,
        documentId: doc.id,
        signatureFor: placements.length > 0 ? (signatureStore.lookup() ?? undefined) : undefined,
        placements: placements.length > 0 ? placements : undefined,
        renderScale: $editorStore.renderScale,
        rotation: doc.rotation,
        watermark: currentWatermarkOptions(),
        stripScripts: $stripEmbeddedScripts,
        redactions: doc.redactions,
        texts: doc.texts,
        comments: [],
        highlights: doc.highlights,
        shapes: doc.shapes,
        images: doc.images,
        formValues: doc.formValues,
        pageNumbers: null,
        headerFooter: null,
        pageWatermark: null,
      });
      source = await readMarkdownSource(bytes, (page, pages) => {
        progress = pages > 1 ? `Reading page ${page} of ${pages}…` : 'Reading the page…';
      });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Conversion failed';
    }
  }
  load();

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      copied = true;
      clearTimeout(copiedTimeout);
      copiedTimeout = setTimeout(() => (copied = false), 2000);
    } catch {
      error = "Couldn't copy to the clipboard. Save the file instead.";
    }
  }

  function save() {
    if (!doc) return;
    downloadMarkdown(markdown, doc.file.name);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMarkdownExport();
    }
    // App's shortcuts (tools, undo, zoom) aren't for the page behind.
    e.stopPropagation();
  }

  // Focus starts inside, so Escape and the keys typed here stay here.
  function focusOnMount(node: HTMLElement) {
    node.focus();
  }

  const segment = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? 'bg-white text-neutral-800 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
        : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100'
    }`;

  const headingClass = ['', 'text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm'];
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
  role="presentation"
  onkeydown={onKeydown}
  onpointerdown={(e) => {
    if (e.target === e.currentTarget) closeMarkdownExport();
  }}
>
  <div
    class="flex h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-neutral-200 bg-white shadow-xl
      dark:border-neutral-800 dark:bg-neutral-900"
    role="dialog"
    aria-modal="true"
    aria-labelledby="markdown-export-title"
    tabindex="-1"
    use:focusOnMount
  >
    <div class="flex items-center gap-3 border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
      <div class="min-w-0 flex-1">
        <h2 id="markdown-export-title" class="text-base font-semibold text-neutral-800 dark:text-neutral-100">
          Markdown
        </h2>
        <p class="truncate text-xs text-neutral-500 dark:text-neutral-400">{doc?.file.name}</p>
      </div>
      <button
        type="button"
        aria-label="Close"
        use:tooltip={'Close (Esc)'}
        class="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100
          hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        onclick={closeMarkdownExport}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
          <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>

    <div
      class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-neutral-200 px-5 py-2.5 text-xs
        text-neutral-600 dark:border-neutral-800 dark:text-neutral-300"
    >
      {#if pageCount > 1}
        <div class="flex items-center gap-2">
          <span>Pages</span>
          <div class="flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
            <button type="button" class={segment(allPages)} aria-pressed={allPages} onclick={() => (allPages = true)}>
              All
            </button>
            <button
              type="button"
              class={segment(!allPages)}
              aria-pressed={!allPages}
              onclick={() => {
                allPages = false;
                if (!rangeText) rangeText = String($activeDocument?.pageNumber ?? 1);
              }}
            >
              Choose
            </button>
          </div>
          {#if !allPages}
            <input
              type="text"
              aria-label="Pages to convert"
              placeholder="1-3, 5"
              class="w-28 rounded-md border bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1
                focus:ring-blue-400 dark:bg-neutral-900
                {chosenPages ? 'border-neutral-200 dark:border-neutral-700' : 'border-red-400'}"
              bind:value={rangeText}
            />
            <span class="text-neutral-400">of {pageCount}</span>
          {/if}
        </div>
      {/if}

      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          class="h-3.5 w-3.5 rounded border-neutral-300 text-blue-600 focus:ring-blue-500 dark:border-neutral-600"
          bind:checked={$markdownFormatting}
        />
        <span>Keep bold and italic</span>
      </label>

      <div class="ml-auto flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
        <button
          type="button"
          class={segment(view === 'preview')}
          aria-pressed={view === 'preview'}
          onclick={() => (view = 'preview')}
        >
          Preview
        </button>
        <button
          type="button"
          class={segment(view === 'markdown')}
          aria-pressed={view === 'markdown'}
          onclick={() => (view = 'markdown')}
        >
          Markdown
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      {#if error}
        <p class="text-sm text-red-600 dark:text-red-400">{error}</p>
      {:else if !source}
        <div class="flex h-full items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <svg viewBox="0 0 24 24" fill="none" class="h-4 w-4 animate-spin">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" opacity="0.25" />
            <path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M21 12a9 9 0 0 0-9-9" />
          </svg>
          {progress}
        </div>
      {:else if !chosenPages}
        <p class="text-sm text-neutral-500 dark:text-neutral-400">
          Type the pages to convert, like 1-3, 5 (from 1 to {pageCount}).
        </p>
      {:else if blocks.length === 0}
        <p class="text-sm text-neutral-500 dark:text-neutral-400">
          No text found on {chosenPages.length > 1 ? 'these pages' : 'this page'}. If it's a scan, use Recognize
          text first.
        </p>
      {:else if view === 'markdown'}
        <pre
          class="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-neutral-700
            dark:text-neutral-200">{markdown}</pre>
      {:else}
        <div class="space-y-3 text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
          {#each blocks as block, i (i)}
            {#if block.kind === 'heading'}
              <svelte:element
                this={`h${block.level}`}
                class="font-semibold text-neutral-900 dark:text-neutral-50 {headingClass[block.level]}
                  {i > 0 ? 'pt-2' : ''}"
              >
                {block.text}
              </svelte:element>
            {:else}
              <p class={block.list ? 'relative pl-6' : ''}>
                {#if block.list}
                  <span class="absolute left-0 text-neutral-400">{block.list === '-' ? '•' : block.list}</span>
                {/if}
                {#each displayRuns(block.runs, $markdownFormatting) as run, j (j)}
                  {#if run.bold && run.italic}<strong><em>{run.text}</em></strong>
                  {:else if run.bold}<strong>{run.text}</strong>
                  {:else if run.italic}<em>{run.text}</em>
                  {:else}{run.text}{/if}
                {/each}
              </p>
            {/if}
          {/each}
        </div>
      {/if}
    </div>

    <div class="flex items-center gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
      <span class="flex-1 text-xs text-neutral-400">
        {#if source && chosenPages && blocks.length > 0}
          {words.toLocaleString()} {words === 1 ? 'word' : 'words'}. Headers, footers, and page numbers left out.
        {/if}
      </span>
      <button
        type="button"
        class="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100
          disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
        disabled={!markdown}
        onclick={copy}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        type="button"
        class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700
          disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!markdown}
        onclick={save}
      >
        Save .md
      </button>
    </div>
  </div>
</div>
