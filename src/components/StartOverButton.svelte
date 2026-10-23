<script lang="ts">
  import { editorStore } from '../stores/editor';
  import { portal } from '../lib/utils/portal';

  // 'full' is the original sidebar button (icon + label, full width). 'icon'
  // is a compact icon-only variant for the header toolbar, matching
  // ThemeToggle/FullscreenToggle's sizing so it sits flush alongside them.
  let { variant = 'full' }: { variant?: 'full' | 'icon' } = $props();

  let showConfirm = $state(false);

  function onClick() {
    if ($editorStore.hasExported) {
      editorStore.reset();
    } else {
      showConfirm = true;
    }
  }

  function confirmReset() {
    showConfirm = false;
    editorStore.reset();
  }

  function cancel() {
    showConfirm = false;
  }
</script>

{#if variant === 'icon'}
  <button
    type="button"
    aria-label="Start over"
    title="Start over: discard everything and go back to the upload screen"
    class="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition-colors
      hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800
      dark:hover:text-neutral-100"
    onclick={onClick}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4.5 w-4.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 1 0 3-6.7" />
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 4v5h5" />
    </svg>
  </button>
{:else}
  <button
    type="button"
    class="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm
      font-medium text-neutral-700 transition-colors hover:bg-neutral-100
      dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
    onclick={onClick}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 1 0 3-6.7" />
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 4v5h5" />
    </svg>
    Start Over
  </button>
{/if}

{#if showConfirm}
  <div use:portal class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div
      class="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl
        dark:border-neutral-800 dark:bg-neutral-900"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="start-over-title"
    >
      <h2 id="start-over-title" class="text-base font-semibold text-neutral-800 dark:text-neutral-100">
        You haven't saved anything yet
      </h2>
      <p class="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        Starting over will discard your PDFs and signature placements. Are you sure you want to continue?
      </p>
      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100
            dark:text-neutral-300 dark:hover:bg-neutral-800"
          onclick={cancel}
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          onclick={confirmReset}
        >
          Start Over
        </button>
      </div>
    </div>
  </div>
{/if}
