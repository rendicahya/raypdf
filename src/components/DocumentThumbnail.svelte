<script lang="ts">
  import { renderPageToCanvas, isPasswordError } from '../lib/pdf/loader';
  import { getCachedPdf } from '../lib/pdf/docCache';

  interface Props {
    id: string;
    file: File;
  }

  let { id, file }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let failure: 'error' | 'locked' | null = $state(null);

  const THUMB_SCALE = 0.2;

  // The canvas stays mounted while showing a failure, so a replaced file
  // (e.g. once a locked PDF is unlocked) renders again.
  $effect(() => {
    const canvas = canvasEl;
    if (!canvas) return;
    failure = null;
    getCachedPdf(id, file)
      .then((pdfDoc) => renderPageToCanvas(pdfDoc, 1, canvas, THUMB_SCALE, 0))
      .catch((e) => {
        failure = isPasswordError(e) ? 'locked' : 'error';
      });
  });
</script>

<div
  class="flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded border
    border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
>
  {#if failure === 'locked'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5 text-amber-500">
      <title>Password protected</title>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  {:else if failure === 'error'}
    <span class="text-[9px] leading-tight text-red-500">Error</span>
  {/if}
  <canvas bind:this={canvasEl} class="max-h-full max-w-full" class:hidden={failure !== null}></canvas>
</div>
