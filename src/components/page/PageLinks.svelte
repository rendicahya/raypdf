<script lang="ts">
  import { editorStore } from '../../stores/editor';
  import { getTotalRotation, type PdfDocument } from '../../lib/pdf/loader';
  import { getPageLinks, type PageLink } from '../../lib/pdf/links';
  import { tooltip } from '../../lib/utils/tooltip';

  // The PDF's own links on one page (lib/pdf/links.ts), as clickable boxes in
  // canvas pixels: web and mail links open in a new tab, links inside the
  // document go to their page. PDFViewer turns them off while a tool is on.

  interface Props {
    pdfDoc: PdfDocument;
    pageNumber: number;
    /** The document's view rotation (PdfDocumentState.rotation). */
    rotation: number;
    scale: number;
    /** Whether the links take clicks (only in Move mode). */
    active: boolean;
  }

  let { pdfDoc, pageNumber, rotation, scale, active }: Props = $props();

  type LinkBox = PageLink & { left: number; top: number; boxWidth: number; boxHeight: number };
  let linkBoxes: LinkBox[] = $state([]);

  $effect(() => {
    const loaded = pdfDoc;
    const page = pageNumber;
    const turn = rotation;
    const s = scale;
    if (page > loaded.numPages) {
      linkBoxes = [];
      return;
    }
    let cancelled = false;
    Promise.all([getPageLinks(loaded, page), loaded.getPage(page)])
      .then(([links, pdfPage]) => {
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale: s, rotation: getTotalRotation(pdfPage, turn) });
        linkBoxes = links.map((l) => {
          const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(l.rect);
          return { ...l, left: Math.min(x1, x2), top: Math.min(y1, y2), boxWidth: Math.abs(x2 - x1), boxHeight: Math.abs(y2 - y1) };
        });
      })
      .catch(() => {
        if (!cancelled) linkBoxes = [];
      });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if linkBoxes.length > 0 && active}
  <div class="pointer-events-none absolute inset-0">
    {#each linkBoxes as l (l.id)}
      {@const linkClass = 'pointer-events-auto absolute block cursor-pointer rounded-sm hover:bg-blue-400/15'}
      {@const position = `left:${l.left}px;top:${l.top}px;width:${l.boxWidth}px;height:${l.boxHeight}px;`}
      {#if l.url}
        <a
          data-pdf-link
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={l.url}
          use:tooltip={l.url}
          class={linkClass}
          style={position}
        ></a>
      {:else if l.page}
        {@const target = l.page}
        <button
          type="button"
          data-pdf-link
          aria-label="Go to page {target}"
          use:tooltip={`Go to page ${target}`}
          class={linkClass}
          style={position}
          onclick={() => editorStore.goToPage(target)}
        ></button>
      {/if}
    {/each}
  </div>
{/if}
