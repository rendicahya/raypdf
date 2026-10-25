<script lang="ts">
  import { onMount } from 'svelte';
  import { renderPageToCanvas, type PdfDocument } from '../lib/pdf/loader';

  interface Props {
    pdfDoc: PdfDocument;
    pageNumber: number;
    rotation: number;
    isActive: boolean;
    /** Part of the sidebar's multi-page selection. */
    isSelected: boolean;
    /** Width / height to reserve before the page has been rendered. */
    placeholderAspect: number;
    /** pdf.js render scale — grows with the sidebar's width so wide thumbnails stay sharp. */
    scale: number;
    /** Gets the click, so Ctrl/Shift can extend the selection instead of just navigating. */
    onSelect: (e: MouseEvent) => void;
    /** This page's redaction boxes, in editor pixels at `renderScale`, drawn black over the thumbnail. */
    redactions: { x: number; y: number; width: number; height: number }[];
    renderScale: number;
  }

  let {
    pdfDoc,
    pageNumber,
    rotation,
    isActive,
    isSelected,
    placeholderAspect,
    scale,
    onSelect,
    redactions,
    renderScale,
  }: Props = $props();

  // The page's size in editor pixels, worked out from the last finished
  // render, so the boxes can be placed as percentages of the thumbnail.
  let pageSize: { width: number; height: number } | null = $state(null);

  let buttonEl: HTMLButtonElement;
  let canvasEl: HTMLCanvasElement;
  let error = $state(false);
  let rendered = $state(false);
  let nearView = $state(false);

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
  let drawn: { doc: PdfDocument; page: number; rotation: number; scale: number } | null = null;

  $effect(() => {
    const doc = pdfDoc;
    const page = pageNumber;
    const rot = rotation;
    const s = scale;
    if (!canvasEl || !nearView) return;
    if (drawn && drawn.doc === doc && drawn.page === page && drawn.rotation === rot && drawn.scale === s) return;
    drawn = { doc, page, rotation: rot, scale: s };
    renderPageToCanvas(doc, page, canvasEl, s, rot)
      .then(() => {
        rendered = true;
        error = false;
        pageSize = { width: canvasEl.width / s, height: canvasEl.height / s };
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
  class:bg-blue-100={isSelected}
  class:dark:bg-blue-950={isSelected}
  aria-pressed={isSelected}
  onclick={onSelect}
>
  <div class="relative w-full overflow-hidden rounded">
    <canvas
      bind:this={canvasEl}
      class="block w-full rounded bg-white shadow-sm"
      style:aspect-ratio={rendered ? null : String(placeholderAspect)}
    ></canvas>
    {#if rendered && pageSize}
      {@const w = pageSize.width * renderScale}
      {@const h = pageSize.height * renderScale}
      {#each redactions as box}
        <div
          class="pointer-events-none absolute bg-black"
          style:left="{(box.x / w) * 100}%"
          style:top="{(box.y / h) * 100}%"
          style:width="{(box.width / w) * 100}%"
          style:height="{(box.height / h) * 100}%"
        ></div>
      {/each}
    {/if}
  </div>
  {#if error}
    <span class="text-[10px] text-red-500">Failed to render</span>
  {/if}
  <span class="text-[11px] text-neutral-500 dark:text-neutral-400">{pageNumber}</span>
</button>
