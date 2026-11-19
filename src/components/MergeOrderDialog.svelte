<script lang="ts">
  import { untrack } from 'svelte';

  interface DocEntry {
    id: string;
    name: string;
  }

  interface Props {
    documents: DocEntry[];
    merging: boolean;
    onConfirm: (orderedIds: string[]) => void;
    onCancel: () => void;
  }

  let { documents, merging, onConfirm, onCancel }: Props = $props();

  // The user's chosen order, as a list of document ids — starts as the
  // documents' current tab order and is reordered in place with the
  // up/down buttons below rather than drag-and-drop, so it works the same
  // with mouse, touch, or keyboard. Deliberately just a one-time initial
  // snapshot (untrack) — this dialog is remounted fresh each time it opens,
  // and re-deriving from `documents` on every change would wipe out
  // whatever reordering the user has already done.
  let order = $state(untrack(() => documents.map((d) => d.id)));

  const orderedDocs = $derived(
    order.map((id) => documents.find((d) => d.id === id)).filter((d): d is DocEntry => !!d),
  );

  function moveUp(index: number) {
    if (index <= 0) return;
    const next = [...order];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    order = next;
  }

  function moveDown(index: number) {
    if (index >= order.length - 1) return;
    const next = [...order];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    order = next;
  }
</script>

<div class="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
  <div
    class="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl
      dark:border-neutral-800 dark:bg-neutral-900"
    role="dialog"
    aria-modal="true"
    aria-labelledby="merge-order-title"
  >
    <h2 id="merge-order-title" class="text-base font-semibold text-neutral-800 dark:text-neutral-100">
      Choose the order of PDFs
    </h2>
    <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
      Pages will appear in the merged PDF in this order.
    </p>

    <ul class="mt-4 flex-1 space-y-1 overflow-y-auto">
      {#each orderedDocs as doc, index (doc.id)}
        <li
          class="flex items-center gap-2 rounded-lg bg-neutral-50 px-2 py-1.5 text-sm dark:bg-neutral-800"
        >
          <span class="w-5 shrink-0 text-right text-xs tabular-nums text-neutral-400">{index + 1}</span>
          <span class="min-w-0 flex-1 truncate">{doc.name}</span>
          <div class="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-label="Move {doc.name} up"
              class="flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-200
                disabled:cursor-not-allowed disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-700"
              disabled={index === 0}
              onclick={() => moveUp(index)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M18 15l-6-6-6 6" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Move {doc.name} down"
              class="flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-200
                disabled:cursor-not-allowed disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-700"
              disabled={index === orderedDocs.length - 1}
              onclick={() => moveDown(index)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
        </li>
      {/each}
    </ul>

    <div class="mt-5 flex justify-end gap-2">
      <button
        type="button"
        class="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100
          disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
        disabled={merging}
        onclick={onCancel}
      >
        Cancel
      </button>
      <button
        type="button"
        class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700
          disabled:cursor-not-allowed disabled:opacity-50"
        disabled={merging}
        onclick={() => onConfirm(order)}
      >
        {merging ? 'Merging…' : 'Merge & Save'}
      </button>
    </div>
  </div>
</div>
