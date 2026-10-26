<script lang="ts">
  import { tick } from 'svelte';
  import PDFViewer from './PDFViewer.svelte';
  import { getCachedPdf } from '../lib/pdf/docCache';
  import { getTotalRotation, isPasswordError, type PdfDocument } from '../lib/pdf/loader';
  import UnlockPdf from './UnlockPdf.svelte';
  import { editorStore, activeDocument } from '../stores/editor';

  // The document as one continuous column of pages. Every page gets a
  // placeholder of its real size, so the scrollbar is right from the start;
  // only pages near the viewport mount a PDFViewer (canvas, text layer,
  // overlays). The page most in view becomes the document's current page,
  // and changing the current page elsewhere (thumbnails, arrows, search)
  // scrolls to it.

  // Remounted per document (a #key block in App.svelte). Within one document
  // the file can still be swapped by page edits and undo, so reload on that.
  const docId = $derived($activeDocument?.id ?? null);
  const docFile = $derived($activeDocument?.file ?? null);
  const rotation = $derived($activeDocument?.rotation ?? 0);
  const currentPage = $derived($activeDocument?.pageNumber ?? 1);
  const scale = $derived($editorStore.renderScale);

  let pdfDoc: PdfDocument | null = $state(null);
  let error: string | null = $state(null);
  let locked = $state(false);
  // Unscaled page sizes, rotated as shown.
  let sizes: { width: number; height: number }[] = $state([]);

  let listEl: HTMLDivElement;
  let scrollEl: HTMLElement | null = null;

  $effect(() => {
    const id = docId;
    const file = docFile;
    const turn = rotation;
    if (id === null || !file) return;
    let cancelled = false;
    getCachedPdf(id, file)
      .then(async (loaded) => {
        const pages = await Promise.all(
          Array.from({ length: loaded.numPages }, (_, i) => loaded.getPage(i + 1)),
        );
        if (cancelled) return;
        const loadedSizes = pages.map((page) => {
          const { width, height } = page.getViewport({ scale: 1, rotation: getTotalRotation(page, turn) });
          return { width, height };
        });
        const changedFile = loaded !== pdfDoc;
        pdfDoc = loaded;
        sizes = loadedSizes;
        error = null;
        locked = false;
        editorStore.setPageCount(loaded.numPages);
        // A new file can renumber pages; show the current one from its top.
        if (changedFile) {
          await tick();
          scrollToPage(currentPage);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        locked = isPasswordError(e);
        error = locked ? null : e instanceof Error ? e.message : 'Failed to load PDF';
      });
    return () => {
      cancelled = true;
    };
  });

  function container(): HTMLElement | null {
    scrollEl ??= listEl?.closest<HTMLElement>('[data-pdf-scroll-container]') ?? null;
    return scrollEl;
  }

  function slotOf(page: number): HTMLElement | null {
    return listEl?.querySelector<HTMLElement>(`[data-page-slot="${page}"]`) ?? null;
  }

  // The page the view last settled on, set before telling the store so the
  // effect below doesn't scroll back to a page the user is already looking at.
  let syncedPage = 0;
  // A scroll this component made itself, ignored when picking the page in view.
  let ownScrollTop: number | null = null;

  function scrollToPage(page: number) {
    const el = container();
    const slot = slotOf(page);
    if (!el || !slot) return;
    syncedPage = page;
    const top = slot.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    el.scrollTop = top - parseFloat(getComputedStyle(el).paddingTop);
    ownScrollTop = el.scrollTop;
  }

  $effect(() => {
    const page = currentPage;
    if (sizes.length === 0 || page === syncedPage) return;
    tick().then(() => scrollToPage(page));
  });

  // The current page is the one under a line 40% down the view, or the last
  // page once scrolled to the bottom.
  function pageInView(): number | null {
    const el = container();
    if (!el || !listEl) return null;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) return sizes.length;
    const line = el.getBoundingClientRect().top + el.clientHeight * 0.4;
    let page: number | null = null;
    for (const slot of listEl.querySelectorAll<HTMLElement>('[data-page-slot]')) {
      if (slot.getBoundingClientRect().top > line) break;
      page = Number(slot.dataset.pageSlot);
    }
    return page ?? 1;
  }

  let scrollFrame = 0;
  function onScroll() {
    const el = container();
    if (el && ownScrollTop !== null && Math.abs(el.scrollTop - ownScrollTop) < 1) {
      ownScrollTop = null;
      return;
    }
    ownScrollTop = null;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      const page = pageInView();
      if (page === null || page === currentPage) return;
      syncedPage = page;
      editorStore.goToPage(page);
    });
  }

  $effect(() => {
    const el = container();
    if (!el) return;
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(scrollFrame);
    };
  });

  // Working on a page makes it the current one, without scrolling.
  function onPointerDownCapture(e: PointerEvent) {
    const slot = (e.target as Element | null)?.closest<HTMLElement>('[data-page-slot]');
    const page = slot ? Number(slot.dataset.pageSlot) : null;
    if (page === null || page === currentPage) return;
    syncedPage = page;
    editorStore.goToPage(page);
  }

  // Zooming or rotating resizes every page: keep the same spot of the
  // current page at the top of the view, or, for Ctrl+wheel, the spot under
  // the pointer where it was. (The Zoom tool then corrects further, to keep
  // the clicked point under the pointer.)
  type Anchor = {
    page: number;
    // The spot as a fraction of its page, and where it sits in the view.
    yRatio: number;
    viewY: number;
    // Null keeps the view centred horizontally (`xRatio` of the scroll width).
    xRatio: number;
    viewX: number | null;
  };
  let anchor: Anchor | null = null;
  let lastLayout = '';
  let zoomPoint: { x: number; y: number } | null = null;

  $effect.pre(() => {
    const layout = `${scale}:${rotation}`;
    if (layout === lastLayout) return;
    const el = container();
    const point = zoomPoint;
    zoomPoint = null;
    const pointSlot = point ? slotAt(point.y) : null;
    const slot = pointSlot ?? slotOf(currentPage);
    if (lastLayout && el && slot) {
      const view = el.getBoundingClientRect();
      const rect = slot.getBoundingClientRect();
      anchor =
        point && pointSlot
          ? {
              page: Number(slot.dataset.pageSlot),
              yRatio: (point.y - rect.top) / rect.height,
              viewY: point.y - view.top,
              xRatio: (point.x - rect.left) / rect.width,
              viewX: point.x - view.left,
            }
          : {
              page: currentPage,
              yRatio: (view.top - rect.top) / rect.height,
              viewY: 0,
              xRatio: el.scrollWidth > el.clientWidth ? (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth : 0.5,
              viewX: null,
            };
    }
    lastLayout = layout;
  });

  $effect(() => {
    void scale;
    void sizes;
    const saved = anchor;
    const el = container();
    if (!saved || !el) return;
    const slot = slotOf(saved.page);
    if (!slot) return;
    anchor = null;
    const view = el.getBoundingClientRect();
    const rect = slot.getBoundingClientRect();
    el.scrollTop += rect.top - view.top + saved.yRatio * slot.offsetHeight - saved.viewY;
    if (saved.viewX === null) el.scrollLeft = saved.xRatio * el.scrollWidth - el.clientWidth / 2;
    else el.scrollLeft += rect.left - view.left + saved.xRatio * slot.offsetWidth - saved.viewX;
    ownScrollTop = el.scrollTop;
  });

  // The page slot level with a screen y, or the nearest one.
  function slotAt(y: number): HTMLElement | null {
    let best: HTMLElement | null = null;
    let bestDistance = Infinity;
    for (const slot of listEl?.querySelectorAll<HTMLElement>('[data-page-slot]') ?? []) {
      const { top, bottom } = slot.getBoundingClientRect();
      const distance = y < top ? top - y : y > bottom ? y - bottom : 0;
      if (distance < bestDistance) {
        best = slot;
        bestDistance = distance;
      }
    }
    return best;
  }

  // Ctrl+wheel (and a touchpad pinch, which arrives as one) zooms the
  // document instead of the browser, a step per mouse notch. Over the page
  // column it zooms around the pointer; elsewhere in the editor, like the
  // zoom buttons.
  const WHEEL_STEP = 50;
  let wheelTotal = 0;
  let lastWheel = 0;

  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (e.timeStamp - lastWheel > 300) wheelTotal = 0;
    lastWheel = e.timeStamp;
    wheelTotal += e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
    if (Math.abs(wheelTotal) < WHEEL_STEP) return;
    const zoomIn = wheelTotal < 0;
    wheelTotal = 0;
    const el = container();
    const over = el && e.target instanceof Node && el.contains(e.target);
    zoomPoint = over ? { x: e.clientX, y: e.clientY } : null;
    const before = $editorStore.renderScale;
    if (zoomIn) editorStore.zoomIn();
    else editorStore.zoomOut();
    // At the zoom limit nothing changes, so don't leave the point for later.
    if ($editorStore.renderScale === before) zoomPoint = null;
  }

  $effect(() => {
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  });

  // Mount pages within about a screen of the view.
  let nearView: Set<number> = $state(new Set());

  function trackVisibility(node: HTMLElement, page: number) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        const next = new Set(nearView);
        if (entry.isIntersecting) next.add(page);
        else next.delete(page);
        nearView = next;
      },
      { root: node.closest('[data-pdf-scroll-container]'), rootMargin: '100% 50%' },
    );
    observer.observe(node);
    return {
      destroy() {
        observer.disconnect();
        if (nearView.has(page)) {
          const next = new Set(nearView);
          next.delete(page);
          nearView = next;
        }
      },
    };
  }
</script>

{#if error}
  <div class="p-4 text-sm text-red-600">{error}</div>
{:else if locked && docId && docFile}
  <div class="flex justify-center p-8">
    <div
      class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
    >
      <UnlockPdf id={docId} file={docFile} />
    </div>
  </div>
{/if}

<div bind:this={listEl} class="mx-auto flex w-fit flex-col items-center gap-6" onpointerdowncapture={onPointerDownCapture}>
  {#if pdfDoc}
    {#each sizes as size, i (i)}
      {@const page = i + 1}
      <div
        data-page-slot={page}
        class="relative shrink-0 rounded-lg bg-white shadow-lg"
        style:width="{Math.floor(size.width * scale)}px"
        style:height="{Math.floor(size.height * scale)}px"
        use:trackVisibility={page}
      >
        {#if nearView.has(page)}
          <PDFViewer pageNumber={page} {pdfDoc} />
        {/if}
      </div>
    {/each}
  {/if}
</div>
