<script lang="ts">
  import { tick } from 'svelte';
  import { editorStore, activeDocument } from '../stores/editor';
  import { search, searchFocusRequest, closeSearch } from '../stores/search';
  import { getCachedPdf } from '../lib/pdf/docCache';
  import { findMatches } from '../lib/pdf/search';
  import { tooltip } from '../lib/utils/tooltip';

  let inputEl: HTMLInputElement | undefined = $state();

  // Focus (and select) the field every time search is opened, including
  // Ctrl+F again while it's already open.
  $effect(() => {
    void $searchFocusRequest;
    if (!$search.open) return;
    tick().then(() => {
      inputEl?.focus();
      inputEl?.select();
    });
  });

  // Re-run whenever the query, the document, or its file (page edits) changes.
  // Debounced so typing doesn't search the whole document on every key.
  const docId = $derived($activeDocument?.id ?? null);
  const docFile = $derived($activeDocument?.file ?? null);
  const query = $derived($search.query);
  const open = $derived($search.open);
  let runId = 0;

  $effect(() => {
    const id = docId;
    const file = docFile;
    const q = query;
    if (!open || !id || !file || !q.trim()) {
      search.update((s) => ({ ...s, matches: [], current: -1, searching: false }));
      return;
    }
    const myRun = ++runId;
    const cancelled = () => myRun !== runId;
    search.update((s) => ({ ...s, searching: true }));
    const timer = setTimeout(async () => {
      try {
        const pdf = await getCachedPdf(id, file);
        const matches = await findMatches(pdf, q, cancelled);
        if (cancelled()) return;
        // Start from the first match at or after the page being viewed, like a browser's find.
        const page = $activeDocument?.pageNumber ?? 1;
        const first = matches.findIndex((m) => m.page >= page);
        search.update((s) => ({
          ...s,
          matches,
          current: matches.length === 0 ? -1 : first === -1 ? 0 : first,
          searching: false,
        }));
        showCurrent();
      } catch {
        if (!cancelled()) search.update((s) => ({ ...s, matches: [], current: -1, searching: false }));
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      runId++;
    };
  });

  function showCurrent() {
    const match = $search.matches[$search.current];
    if (match && match.page !== $activeDocument?.pageNumber) editorStore.goToPage(match.page);
  }

  function step(delta: number) {
    const count = $search.matches.length;
    if (count === 0) return;
    search.update((s) => ({ ...s, current: (s.current + delta + count) % count }));
    showCurrent();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSearch();
    }
  }

  const status = $derived.by(() => {
    if (!$search.query.trim()) return '';
    if ($search.searching) return 'Searching…';
    if ($search.matches.length === 0) return 'No results';
    return `${$search.current + 1} of ${$search.matches.length}`;
  });

  const buttonClass =
    'flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 ' +
    'hover:text-neutral-800 disabled:pointer-events-none disabled:opacity-40 dark:text-neutral-400 ' +
    'dark:hover:bg-neutral-800 dark:hover:text-neutral-100';
</script>

{#if $search.open}
  <div
    role="search"
    class="absolute right-4 top-3 z-30 flex items-center gap-1 rounded-xl border border-neutral-200 bg-white/95 p-1
      pl-2.5 shadow-lg backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4 shrink-0 text-neutral-400">
      <path stroke-linecap="round" stroke-linejoin="round" d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M21 21l-4.3-4.3" />
    </svg>
    <input
      bind:this={inputEl}
      type="search"
      aria-label="Find in document"
      placeholder="Find in document"
      class="w-48 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-neutral-400 dark:text-neutral-100"
      value={$search.query}
      oninput={(e) => search.update((s) => ({ ...s, query: e.currentTarget.value }))}
      onkeydown={onKeydown}
    />
    <span
      class="min-w-[4.5rem] text-right text-xs tabular-nums text-neutral-500 dark:text-neutral-400"
      aria-live="polite"
    >
      {status}
    </span>
    <span class="mx-0.5 h-5 w-px bg-neutral-200 dark:bg-neutral-700"></span>
    <button
      type="button"
      class={buttonClass}
      aria-label="Previous match"
      use:tooltip={'Previous match (Shift+Enter)'}
      disabled={$search.matches.length === 0}
      onclick={() => step(-1)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
        <path stroke-linecap="round" stroke-linejoin="round" d="m6 15 6-6 6 6" />
      </svg>
    </button>
    <button
      type="button"
      class={buttonClass}
      aria-label="Next match"
      use:tooltip={'Next match (Enter)'}
      disabled={$search.matches.length === 0}
      onclick={() => step(1)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
        <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
      </svg>
    </button>
    <button type="button" class={buttonClass} aria-label="Close search" use:tooltip={'Close (Esc)'} onclick={closeSearch}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
        <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  </div>
{/if}
