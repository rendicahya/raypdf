<script lang="ts">
  import { ocrStatus, cancelOcr, dismissOcrStatus, isOcrRunning } from '../stores/ocr';
  import { search } from '../stores/search';

  // Progress and outcome of Recognize text (stores/ocr.ts), over the top of
  // the pages (below SearchBar while it's open).
  const running = $derived(isOcrRunning($ocrStatus));
  const selecting = $derived($ocrStatus.state === 'selecting');
  const copyText = $derived($ocrStatus.state === 'finished' ? $ocrStatus.text : undefined);
  const message = $derived.by(() => {
    const s = $ocrStatus;
    switch (s.state) {
      case 'selecting':
        return 'Drag a rectangle around the text to recognize.';
      case 'checking':
        return 'Looking for scanned pages…';
      case 'loading':
        return 'Getting text recognition ready…';
      case 'recognizing':
        return s.total === 1 ? 'Recognizing text…' : `Recognizing text, page ${s.done + 1} of ${s.total}…`;
      case 'finished':
        return s.message;
      default:
        return '';
    }
  });
  const progress = $derived(
    $ocrStatus.state === 'recognizing' ? ($ocrStatus.done + 0.5) / $ocrStatus.total : null,
  );

  let copied = $state(false);
  $effect(() => {
    void copyText;
    copied = false;
  });

  async function copy() {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      copied = true;
    } catch (e) {
      console.error(e);
    }
  }

  const buttonClass =
    'shrink-0 rounded-md px-2 py-1 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 ' +
    'hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100';
</script>

{#if $ocrStatus.state !== 'idle'}
  <div
    role="status"
    class="absolute left-1/2 {$search.open ? 'top-16' : 'top-3'} z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl
      border border-neutral-200 bg-white/95 py-2 pl-3.5 pr-2 text-sm shadow-lg backdrop-blur
      dark:border-neutral-800 dark:bg-neutral-900/95"
  >
    {#if running}
      <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" class="opacity-25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
      </svg>
    {/if}
    <div class="min-w-0">
      <p class={$ocrStatus.state === 'finished' && $ocrStatus.error ? 'text-red-600 dark:text-red-400' : ''}>
        {message}
      </p>
      {#if $ocrStatus.state === 'loading'}
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          The first time, this downloads about 4.5 MB. Your files stay on this device.
        </p>
      {/if}
      {#if progress !== null}
        <div class="mt-1.5 h-1 w-48 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div class="h-full rounded-full bg-blue-600 transition-[width] dark:bg-blue-400" style:width="{progress * 100}%"></div>
        </div>
      {/if}
    </div>
    {#if copyText}
      <button
        type="button"
        class="shrink-0 rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700
          dark:bg-blue-500 dark:hover:bg-blue-400"
        onclick={copy}
      >
        {copied ? 'Copied' : 'Copy text'}
      </button>
    {/if}
    <button type="button" class={buttonClass} onclick={running || selecting ? cancelOcr : dismissOcrStatus}>
      {running || selecting ? 'Cancel' : 'Close'}
    </button>
  </div>
{/if}
