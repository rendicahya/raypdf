<script lang="ts">
  import { fly } from 'svelte/transition';
  import { lastDownload } from '../stores/downloadToast';

  /** How long the toast stays, restarted by each new download. */
  const SHOW_MS = 4000;

  $effect(() => {
    if (!$lastDownload) return;
    const timer = setTimeout(() => lastDownload.set(null), SHOW_MS);
    return () => clearTimeout(timer);
  });
</script>

<!-- Above the editor's dialogs, since some (like the Markdown preview) stay open after saving. -->
{#if $lastDownload}
  {#key $lastDownload.at}
    <div
      role="status"
      transition:fly={{ y: 12, duration: 180 }}
      class="fixed bottom-4 right-4 z-[100] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border
        border-neutral-200 bg-white py-2 pl-3 pr-1.5 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
      </svg>
      <span class="min-w-0 truncate text-neutral-700 dark:text-neutral-200">
        Downloaded <span class="font-medium">{$lastDownload.fileName}</span>
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100
          dark:text-neutral-400 dark:hover:bg-neutral-800"
        onclick={() => lastDownload.set(null)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
          <path stroke-linecap="round" d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  {/key}
{/if}
