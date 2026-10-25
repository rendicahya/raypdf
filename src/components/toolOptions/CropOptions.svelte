<script lang="ts">
  import { editorStore, activeDocument } from '../../stores/editor';
  import { cropFrame } from '../../stores/cropTool';
  import { getCachedPdf } from '../../lib/pdf/docCache';
  import { findContentBounds } from '../../lib/pdf/contentBounds';
  import PanelHeader from './PanelHeader.svelte';

  // The Crop tool's panel: the frame is drawn on the page (CropOverlay), and
  // applied from here to that page or to every page.

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const pageCount = $derived($activeDocument?.pageCount ?? 1);
  const currentPage = $derived($activeDocument?.pageNumber ?? 1);
  const frame = $derived($cropFrame);

  let busy = $state(false);
  let message: string | null = $state(null);
  let messageTimeout: ReturnType<typeof setTimeout> | undefined;

  function say(text: string) {
    clearTimeout(messageTimeout);
    message = text;
    messageTimeout = setTimeout(() => (message = null), 3000);
  }

  async function run(work: () => Promise<unknown>, done: string) {
    if (busy) return;
    busy = true;
    try {
      await work();
      say(done);
    } catch (e) {
      say(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      busy = false;
    }
  }

  function crop(pages: number[]) {
    const f = frame;
    if (!f) return;
    run(async () => {
      await editorStore.cropPages(pages, f);
      cropFrame.set(null);
    }, pages.length > 1 ? `Cropped ${pages.length} pages` : `Cropped page ${pages[0]}`);
  }

  const allPages = () => Array.from({ length: pageCount }, (_, i) => i + 1);

  // Frames what's on the current page, leaving out the blank margins.
  async function fitToContent() {
    const doc = $activeDocument;
    if (!doc || busy) return;
    busy = true;
    try {
      const page = doc.pageNumber;
      const bounds = await findContentBounds(await getCachedPdf(doc.id, doc.file), page, doc.rotation);
      if (bounds) cropFrame.set({ page, ...bounds });
      else say(`Page ${page} looks blank`);
    } catch (e) {
      say(e instanceof Error ? e.message : 'Could not read the page');
    } finally {
      busy = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || !frame) return;
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return;
    e.preventDefault();
    crop([frame.page]);
  }

  const buttonClass =
    'w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-700 transition-colors ' +
    'hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 ' +
    'dark:text-neutral-200 dark:hover:bg-neutral-800';
  const linkClass =
    'rounded-md px-2 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-50 ' +
    'dark:text-neutral-300 dark:hover:bg-neutral-800';
</script>

<svelte:window onkeydown={onKeydown} />

<div>
  <PanelHeader title="Crop" {onClose} closeLabel="Close" />

  <p class="text-xs text-neutral-500 dark:text-neutral-400">
    Drag on a page to frame the part to keep. Drag the frame to move it, or its edges to resize it.
  </p>

  <div class="mt-4 flex flex-col gap-2">
    <button type="button" class={buttonClass} disabled={busy} onclick={fitToContent}>
      Frame the content of page {currentPage}
    </button>
    <p class="-mt-1 text-xs text-neutral-400">Leaves out the blank margins around it.</p>
  </div>

  <div class="mt-4 flex flex-col gap-2">
    <button
      type="button"
      class="w-full rounded-lg bg-orange-600 px-3 py-2 text-xs font-medium text-white transition-colors
        hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={!frame || busy}
      onclick={() => frame && crop([frame.page])}
    >
      {frame ? `Crop page ${frame.page}` : 'Crop this page'}
    </button>
    {#if pageCount > 1}
      <button type="button" class={buttonClass} disabled={!frame || busy} onclick={() => crop(allPages())}>
        Crop all {pageCount} pages the same way
      </button>
    {/if}
    <p class="text-xs text-neutral-400">
      {frame ? 'Or press Enter to crop this page.' : 'Draw a frame first.'}
      {#if pageCount > 1}
        Pages of other sizes are cropped in proportion.
      {/if}
    </p>
  </div>

  {#if message}
    <p class="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{message}</p>
  {/if}

  <div class="mt-5 border-t border-neutral-200 pt-3 dark:border-neutral-800">
    <h4 class="text-xs font-medium text-neutral-600 dark:text-neutral-300">Show the whole page again</h4>
    <div class="mt-1 flex flex-wrap gap-1">
      <button
        type="button"
        class={linkClass}
        disabled={busy}
        onclick={() => run(() => editorStore.uncropPages([currentPage]), `Page ${currentPage} shown in full`)}
      >
        Page {currentPage}
      </button>
      {#if pageCount > 1}
        <button
          type="button"
          class={linkClass}
          disabled={busy}
          onclick={() => run(() => editorStore.uncropPages(allPages()), 'Every page shown in full')}
        >
          All pages
        </button>
      {/if}
    </div>
    <p class="mt-2 text-xs text-neutral-400">
      Cropping hides the edges; what's cut off stays in the file. To remove something for good, use Redact.
    </p>
  </div>
</div>
