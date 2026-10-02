<script lang="ts">
  import { editorStore, activeDocument } from '../stores/editor';
  import { pageSidebarOpen } from '../stores/layout';
  import { getCachedPdf } from '../lib/pdf/docCache';
  import type { PdfDocument } from '../lib/pdf/loader';
  import PageThumbnail from './PageThumbnail.svelte';

  let pdfDoc: PdfDocument | null = $state(null);
  let error: string | null = $state(null);

  // Only the identity of the document matters here. Depending on the whole $activeDocument object
  // would re-run the effect (and unmount the thumbnails, resetting scroll) on every page change.
  const docId = $derived($activeDocument?.id ?? null);
  const docFile = $derived($activeDocument?.file ?? null);

  // Reloads (from the shared cache — usually a no-op parse) whenever the active document changes.
  $effect(() => {
    const id = docId;
    const file = docFile;
    if (id === null || !file) {
      pdfDoc = null;
      return;
    }
    let cancelled = false;
    pdfDoc = null;
    error = null;
    getCachedPdf(id, file)
      .then((loaded) => {
        if (!cancelled) pdfDoc = loaded;
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
</script>

{#if $pageSidebarOpen}
  <aside class="flex w-44 shrink-0 flex-col gap-2 overflow-y-auto border-r border-neutral-200 bg-neutral-50 p-3
    dark:border-neutral-800 dark:bg-neutral-900">
    {#if error}
      <p class="text-xs text-red-600">{error}</p>
    {:else if pdfDoc}
      {#each pageNumbers as pageNumber (pageNumber)}
        <PageThumbnail
          {pdfDoc}
          {pageNumber}
          rotation={activeRotation}
          isActive={pageNumber === activePageNumber}
          onSelect={() => editorStore.goToPage(pageNumber)}
        />
      {/each}
    {/if}
  </aside>
{/if}
