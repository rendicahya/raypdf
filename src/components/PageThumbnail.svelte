<script lang="ts">
  import { onMount } from 'svelte';
  import { renderPageToCanvas, type PdfDocument } from '../lib/pdf/loader';

  interface Props {
    pdfDoc: PdfDocument;
    pageNumber: number;
    rotation: number;
    isActive: boolean;
    /** Width / height to reserve before the page has been rendered. */
    placeholderAspect: number;
    onSelect: () => void;
  }

  let { pdfDoc, pageNumber, rotation, isActive, placeholderAspect, onSelect }: Props = $props();

  let buttonEl: HTMLButtonElement;
  let canvasEl: HTMLCanvasElement;
  let error = $state(false);
  let rendered = $state(false);
  let nearView = $state(false);

  const THUMB_SCALE = 0.22;

  // Thumbnails render only once they're scrolled near the sidebar's visible
  // area, so a 300-page PDF doesn't render 300 pages up front. The margin
  // starts the next few just before they come into view.
  onMount(() => {
    const root = buttonEl.closest('[data-thumbnail-scroll]');
    const observer = new IntersectionObserver(
      ([entry]) => {
        nearView = entry.isIntersecting;
      },
      { root, rootMargin: '600px 0px' },
    );
    observer.observe(buttonEl);
    return () => observer.disconnect();
  });

  // What's currently drawn, so scrolling a thumbnail back into view doesn't
  // render it again unless the page itself changed.
  let drawn: { doc: PdfDocument; page: number; rotation: number } | null = null;

  $effect(() => {
    const doc = pdfDoc;
    const page = pageNumber;
    const rot = rotation;
    if (!canvasEl || !nearView) return;
    if (drawn && drawn.doc === doc && drawn.page === page && drawn.rotation === rot) return;
    drawn = { doc, page, rotation: rot };
    renderPageToCanvas(doc, page, canvasEl, THUMB_SCALE, rot)
      .then(() => {
        rendered = true;
        error = false;
      })
      .catch(() => {
        drawn = null;
        error = true;
      });
  });

  // Keep the current page's thumbnail in view as the user pages through a long document.
  $effect(() => {
    if (isActive) buttonEl?.scrollIntoView({ block: 'nearest' });
  });
</script>

<button
  bind:this={buttonEl}
  type="button"
  class="flex w-full flex-col items-center gap-1 rounded-lg border-2 p-1 transition-colors"
  class:border-blue-500={isActive}
  class:border-transparent={!isActive}
  class:hover:border-neutral-300={!isActive}
  class:dark:hover:border-neutral-600={!isActive}
  onclick={onSelect}
>
  <canvas
    bind:this={canvasEl}
    class="w-full rounded bg-white shadow-sm"
    style:aspect-ratio={rendered ? null : String(placeholderAspect)}
  ></canvas>
  {#if error}
    <span class="text-[10px] text-red-500">Failed to render</span>
  {/if}
  <span class="text-[11px] text-neutral-500 dark:text-neutral-400">{pageNumber}</span>
</button>
