<script lang="ts">
  import { editorStore, activeDocument } from '../../stores/editor';
  import { getCachedPdf } from '../../lib/pdf/docCache';
  import { boxToRatio, boxFromRatioForDocument } from '../../lib/pdf/placement';
  import PanelHeader from './PanelHeader.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const redactions = $derived($activeDocument?.redactions ?? []);
  const otherDocumentCount = $derived($editorStore.documents.length - 1);

  // Boxes counted per page, in page order, for the jump list.
  const pages = $derived(
    Array.from(
      redactions.reduce((counts, box) => counts.set(box.page, (counts.get(box.page) ?? 0) + 1), new Map<number, number>()),
    ).sort(([a], [b]) => a - b),
  );

  let applying = $state(false);
  let applyError: string | null = $state(null);
  let applySuccess: string | null = $state(null);
  let applySuccessTimeout: ReturnType<typeof setTimeout> | undefined;

  // Makes every other open document's redactions match the active document's
  // exactly, not a merge: each target's whole redaction set is replaced with
  // a converted copy of the active document's boxes, so re-running this after
  // moving/resizing/adding/removing boxes on the active document always
  // leaves the others in sync rather than accumulating leftovers. A box whose
  // page doesn't exist on a given target is simply dropped for that target.
  async function applyToAll() {
    const active = $activeDocument;
    const documents = $editorStore.documents;
    if (!active || active.redactions.length === 0) return;

    applying = true;
    applyError = null;
    applySuccess = null;
    clearTimeout(applySuccessTimeout);
    try {
      const activePdf = await getCachedPdf(active.id, active.file);
      const ratios = await Promise.all(
        active.redactions.map(async (box) => ({
          page: box.page,
          ratio: await boxToRatio(activePdf, box.page, $editorStore.renderScale, active.rotation, box),
        })),
      );

      const partiallySynced: string[] = [];

      for (const doc of documents) {
        if (doc.id === active.id) continue;

        const applicable = ratios.filter((r) => r.page <= doc.pageCount);
        if (applicable.length < ratios.length) partiallySynced.push(doc.file.name);

        const pdfjsDoc = await getCachedPdf(doc.id, doc.file);
        const newBoxes = await Promise.all(
          applicable.map((r) =>
            boxFromRatioForDocument(pdfjsDoc, r.page, $editorStore.renderScale, doc.rotation, r.ratio),
          ),
        );
        editorStore.setRedactionsForDocument(doc.id, newBoxes);
      }

      if (partiallySynced.length > 0) {
        applyError = `Not fully synced (fewer pages there): ${partiallySynced.join(', ')}`;
      } else {
        applySuccess = `Applied to ${otherDocumentCount} other document${otherDocumentCount > 1 ? 's' : ''}`;
        applySuccessTimeout = setTimeout(() => (applySuccess = null), 2500);
      }
    } catch (e) {
      applyError = e instanceof Error ? e.message : 'Failed to apply redaction to all documents';
    } finally {
      applying = false;
    }
  }
</script>

<div>
  <PanelHeader title="Redact" {onClose} />

  <p class="text-xs text-neutral-500 dark:text-neutral-400">
    Drag over the page to draw a box. Everything under it is removed from the saved PDF, not just covered.
  </p>

  <div class="mt-4">
    <h4 class="text-xs font-medium text-neutral-600 dark:text-neutral-300">In this document</h4>
    {#if pages.length === 0}
      <p class="mt-1 text-xs text-neutral-400">No redactions yet.</p>
    {:else}
      <ul class="mt-1 space-y-0.5">
        {#each pages as [page, count] (page)}
          <li>
            <button
              type="button"
              class="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs
                text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              class:font-semibold={page === $activeDocument?.pageNumber}
              onclick={() => editorStore.goToPage(page)}
            >
              <span>Page {page}</span>
              <span class="text-neutral-400">{count} box{count > 1 ? 'es' : ''}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if otherDocumentCount > 0}
    <div class="mt-4">
      <button
        type="button"
        class="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-700
          transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50
          dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        disabled={applying || redactions.length === 0}
        onclick={applyToAll}
      >
        {applying ? 'Applying…' : `Apply to All ${otherDocumentCount + 1} Documents`}
      </button>
      <p class="mt-1 text-xs text-neutral-400">
        Makes every other open document's redactions match this one exactly.
      </p>
      {#if applyError}
        <p class="mt-1 text-xs text-red-600 dark:text-red-400">{applyError}</p>
      {:else if applySuccess}
        <p class="mt-1 text-xs text-emerald-600 dark:text-emerald-400">{applySuccess}</p>
      {/if}
    </div>
  {/if}
</div>
