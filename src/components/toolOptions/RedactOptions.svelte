<script lang="ts">
  import { editorStore, activeDocument, type RedactionBox } from '../../stores/editor';
  import { getCachedPdf } from '../../lib/pdf/docCache';
  import { boxToRatio, boxFromRatioForDocument } from '../../lib/pdf/placement';
  import { tooltip } from '../../lib/utils/tooltip';
  import PanelHeader from './PanelHeader.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const redactions = $derived($activeDocument?.redactions ?? []);
  const pageCount = $derived($activeDocument?.pageCount ?? 1);
  const otherDocumentCount = $derived($editorStore.documents.length - 1);

  // Boxes grouped by page, in page order, each page's boxes top to bottom.
  const pages = $derived(
    Array.from(
      redactions.reduce(
        (groups, box) => groups.set(box.page, [...(groups.get(box.page) ?? []), box]),
        new Map<number, RedactionBox[]>(),
      ),
    )
      .sort(([a], [b]) => a - b)
      .map(([page, boxes]) => ({ page, boxes: boxes.sort((a, b) => a.y - b.y || a.x - b.x) })),
  );

  let copying = $state(false);
  let copyMessage: string | null = $state(null);
  let copyMessageTimeout: ReturnType<typeof setTimeout> | undefined;

  // Copies one box to the same spot (as a fraction of the page, so pages of
  // another size still get it in the matching place) on every other page.
  // Pages that already have a box there are skipped, so pressing it twice
  // doesn't stack duplicates.
  async function copyToAllPages(box: RedactionBox) {
    const doc = $activeDocument;
    if (!doc || copying) return;
    copying = true;
    clearTimeout(copyMessageTimeout);
    try {
      const pdf = await getCachedPdf(doc.id, doc.file);
      const scale = $editorStore.renderScale;
      const ratio = await boxToRatio(pdf, box.page, scale, doc.rotation, box);
      const targets = Array.from({ length: doc.pageCount }, (_, i) => i + 1).filter((p) => p !== box.page);
      const candidates = await Promise.all(
        targets.map((page) => boxFromRatioForDocument(pdf, page, scale, doc.rotation, ratio)),
      );
      const near = (a: number, b: number) => Math.abs(a - b) < 1;
      const added = candidates.filter(
        (c) =>
          !doc.redactions.some(
            (r) =>
              r.page === c.page && near(r.x, c.x) && near(r.y, c.y) && near(r.width, c.width) && near(r.height, c.height),
          ),
      );
      editorStore.addRedactions(added);
      copyMessage =
        added.length > 0
          ? `Copied to ${added.length} page${added.length > 1 ? 's' : ''}`
          : 'Every page already has this box';
    } catch (e) {
      copyMessage = e instanceof Error ? e.message : 'Failed to copy the box';
    } finally {
      copying = false;
      copyMessageTimeout = setTimeout(() => (copyMessage = null), 2500);
    }
  }

  const iconButtonClass =
    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors ' +
    'disabled:pointer-events-none disabled:opacity-40';

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

{#snippet trashIcon()}
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
    />
  </svg>
{/snippet}

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
      <ul class="mt-1 space-y-1">
        {#each pages as { page, boxes } (page)}
          <li>
            <div class="flex items-center gap-1">
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center justify-between rounded-md px-2 py-1 text-left text-xs
                  text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                class:font-semibold={page === $activeDocument?.pageNumber}
                onclick={() => editorStore.goToPage(page)}
              >
                <span>Page {page}</span>
                <span class="text-neutral-400">{boxes.length} box{boxes.length > 1 ? 'es' : ''}</span>
              </button>
              <button
                type="button"
                aria-label="Remove the redactions on page {page}"
                use:tooltip={`Remove the redactions on page ${page}`}
                class={iconButtonClass + ' hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/50'}
                onclick={() => editorStore.removeRedactionsOnPage(page)}
              >
                {@render trashIcon()}
              </button>
            </div>
            <ul class="ml-3 border-l border-neutral-200 pl-2 dark:border-neutral-700">
              {#each boxes as box, i (box.id)}
                <li class="flex items-center gap-1">
                  <button
                    type="button"
                    class="min-w-0 flex-1 rounded-md px-2 py-0.5 text-left text-xs text-neutral-500
                      hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                    onclick={() => editorStore.goToPage(page)}
                  >
                    Box {i + 1}
                  </button>
                  {#if pageCount > 1}
                    <button
                      type="button"
                      aria-label="Copy this box to every other page"
                      use:tooltip={'Copy to the same spot on every other page'}
                      class={iconButtonClass + ' hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'}
                      disabled={copying}
                      onclick={() => copyToAllPages(box)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                        <rect x="8" y="8" width="12" height="12" rx="2" />
                        <path stroke-linecap="round" stroke-linejoin="round" d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                      </svg>
                    </button>
                  {/if}
                  <button
                    type="button"
                    aria-label="Remove this box"
                    use:tooltip={'Remove this box'}
                    class={iconButtonClass + ' hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/50'}
                    onclick={() => editorStore.removeRedaction(box.id)}
                  >
                    {@render trashIcon()}
                  </button>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
      {#if copyMessage}
        <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{copyMessage}</p>
      {/if}
      <button
        type="button"
        class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 py-2
          text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900
          dark:text-red-400 dark:hover:bg-red-950/50"
        onclick={() => editorStore.removeAllRedactions()}
      >
        {@render trashIcon()}
        Remove all redactions
      </button>
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
