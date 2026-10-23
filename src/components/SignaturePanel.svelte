<script lang="ts">
  import { signatureStore } from '../stores/signature';
  import { editorStore, activeDocument } from '../stores/editor';
  import { lastPlacement } from '../stores/placement';
  import { clickToPlaceMode } from '../stores/clickToPlace';
  import { textToolMode } from '../stores/textTool';
  import { zoomToolMode } from '../stores/zoomTool';
  import { textSelectMode } from '../stores/textSelect';
  import { screenshotToolMode } from '../stores/screenshotTool';
  import {
    watermarkText,
    includeTimestamp,
    watermarkPosition,
    watermarkFontScale,
    WATERMARK_FONT_SCALE_MIN,
    WATERMARK_FONT_SCALE_MAX,
    WATERMARK_FONT_SCALE_STEP,
    watermarkColor,
    watermarkOpacity,
    WATERMARK_OPACITY_MIN,
    WATERMARK_OPACITY_MAX,
    WATERMARK_OPACITY_STEP,
    type WatermarkPosition,
    savedWatermarkTexts,
    saveWatermarkText,
    removeSavedWatermarkText,
  } from '../stores/watermark';
  import { tooltip } from '../lib/utils/tooltip';
  import { buildWatermarkLines, parsePosition } from '../lib/watermark/visible';
  import { fitWithinBox } from '../lib/signature/layout';
  import { getCachedPdf } from '../lib/pdf/docCache';
  import { boxToRatio, placementFromRatioForDocument } from '../lib/pdf/placement';
  import { findSignatureSpot } from '../lib/pdf/signatureDetect';
  import { signatureSuggestion } from '../stores/signatureSuggestion';
  import { wheelRange } from '../lib/utils/wheelRange';
  import { SIGNATURE_DRAG_TYPE } from '../lib/signature/layout';
  import SignatureCreator from './SignatureCreator.svelte';

  const sig = $derived($signatureStore);

  // Live preview of the watermark that export.ts / applyVisibleWatermark will
  // bake into the signature image — mirrors its layout math (see
  // lib/watermark/visible.ts) but renders as an HTML overlay instead of a
  // canvas so it updates instantly as the user tweaks the controls below.
  let sigImgHeight = $state(0);
  const watermarkLines = $derived(buildWatermarkLines({ customText: $watermarkText, includeTimestamp: $includeTimestamp }));
  const watermarkAlign = $derived(parsePosition($watermarkPosition));
  const watermarkPreviewFontSize = $derived(Math.max(10, Math.round(sigImgHeight * $watermarkFontScale)));
  const watermarkPreviewLineHeight = $derived(watermarkPreviewFontSize * 1.2);
  const watermarkPreviewPadding = $derived(Math.round(sigImgHeight * 0.06));

  // Saved watermark texts: chips under the text box fill it with one click.
  const trimmedWatermarkText = $derived($watermarkText.trim());
  const watermarkTextSaved = $derived($savedWatermarkTexts.includes(trimmedWatermarkText));

  // Saved signatures: draw, type, or upload new ones (SignatureCreator), pick
  // which one new placements use, drag any of them onto the page.
  let creatorOpen = $state(false);

  // Deleting a signature that's placed somewhere asks first — those placements
  // would switch to showing the active signature instead.
  let pendingDelete: { id: string; label: string; uses: number } | null = $state(null);

  function placementsUsing(id: string): number {
    return $editorStore.documents.reduce(
      (n, doc) => n + doc.placedSignatures.filter((p) => p.signatureId === id).length,
      0,
    );
  }

  function requestDelete(id: string) {
    const entry = sig.signatures.find((s) => s.id === id);
    if (!entry) return;
    const uses = placementsUsing(id);
    if (uses > 0) pendingDelete = { id, label: entry.label, uses };
    else signatureStore.remove(id);
  }

  function confirmDelete() {
    if (pendingDelete) signatureStore.remove(pendingDelete.id);
    pendingDelete = null;
  }

  const canUseLastPosition = $derived(!!$lastPlacement);

  let applyingLastPosition = $state(false);

  let applyingToAll = $state(false);
  let applyToAllError: string | null = $state(null);

  // Page counts are resolved eagerly for every uploaded document (not just
  // the active one) as soon as they're added — see stores/editor.ts — so
  // this reliably reflects every document's real length, not just whichever
  // one has been opened so far.
  const allSinglePage = $derived($editorStore.documents.every((d) => d.pageCount === 1));

  const POSITIONS: WatermarkPosition[] = [
    'top-left',
    'top-center',
    'top-right',
    'center-left',
    'center',
    'center-right',
    'bottom-left',
    'bottom-center',
    'bottom-right',
  ];

  function onDragStart(e: DragEvent, id: string) {
    e.dataTransfer?.setData(SIGNATURE_DRAG_TYPE, id);
    e.dataTransfer?.setData('text/plain', 'signature');
  }

  function placeAtDefault() {
    // Simple click-to-place fallback for non-drag interactions (e.g. touch).
    const doc = $activeDocument;
    if (!doc || !sig.activeId) return;
    const { width, height } = fitWithinBox(sig.naturalWidth, sig.naturalHeight);
    // Cascade position so repeated clicks don't stack exactly on top of each other.
    const offset = (doc.placedSignatures.length % 6) * 24;
    editorStore.addSignature({
      x: 40 + offset,
      y: 40 + offset,
      width,
      height,
      page: doc.pageNumber,
      signatureId: sig.activeId,
    });
  }

  // Best-effort scan of the current document's text for a likely signature
  // spot (a blank line, or a "Signature"/"Tanda Tangan"/"TTD" label — see
  // lib/pdf/signatureDetect.ts). Never places anything itself — it jumps to
  // the page it found and leaves a "click to place here" suggestion for the
  // user to confirm or dismiss in PDFViewer.
  let detectingSpot = $state(false);
  let detectSpotError: string | null = $state(null);

  async function findSpot() {
    const doc = $activeDocument;
    if (!doc || !sig.signature) return;

    detectingSpot = true;
    detectSpotError = null;
    signatureSuggestion.set(null);
    try {
      const pdfjsDoc = await getCachedPdf(doc.id, doc.file);
      const spot = await findSignatureSpot(
        pdfjsDoc,
        $editorStore.renderScale,
        doc.rotation,
        doc.pageNumber,
        sig.naturalWidth,
        sig.naturalHeight,
      );
      if (!spot) {
        detectSpotError = "Couldn't find a likely spot — try placing it manually.";
        return;
      }
      if (spot.page !== doc.pageNumber) editorStore.goToPage(spot.page);
      signatureSuggestion.set({ ...spot, documentId: doc.id });
    } catch (e) {
      detectSpotError = e instanceof Error ? e.message : 'Failed to scan the document';
    } finally {
      detectingSpot = false;
    }
  }

  async function useLastPosition() {
    const doc = $activeDocument;
    const ratio = $lastPlacement;
    const signatureId = sig.activeId;
    if (!doc || !ratio || !signatureId) return;

    applyingLastPosition = true;
    try {
      const pdfjsDoc = await getCachedPdf(doc.id, doc.file);
      const placement = await placementFromRatioForDocument(
        pdfjsDoc,
        doc.pageNumber,
        $editorStore.renderScale,
        doc.rotation,
        ratio,
        signatureId,
      );
      const { id, ...rest } = placement;
      editorStore.addSignature(rest);
    } finally {
      applyingLastPosition = false;
    }
  }

  // The signature(s) placed on whichever page is currently on screen — the
  // source for "Apply Signature to All Pages" below.
  const currentPageSignatures = $derived(
    $activeDocument?.placedSignatures.filter((sig) => sig.page === $activeDocument?.pageNumber) ?? [],
  );
  const canApplySignatureToAllPages = $derived(
    ($activeDocument?.pageCount ?? 1) > 1 && currentPageSignatures.length > 0,
  );

  let applyingSignatureToAllPages = $state(false);
  let applySignatureError: string | null = $state(null);
  let applySignatureSuccess: string | null = $state(null);
  let applySignatureSuccessTimeout: ReturnType<typeof setTimeout> | undefined;

  // Replicates the current page's signature placement(s) onto every other
  // page of the same document, at the same relative position — for
  // documents that need a signature/initial on each page rather than just
  // one. This is a full replace (not a merge) of every other page's
  // placements, so re-running it after moving the source placement keeps
  // every page in sync rather than accumulating stale copies.
  async function applySignatureToAllPages() {
    const doc = $activeDocument;
    if (!doc) return;
    const sourcePage = doc.pageNumber;
    const sourcePlacements = doc.placedSignatures.filter((sig) => sig.page === sourcePage);
    if (sourcePlacements.length === 0) return;

    applyingSignatureToAllPages = true;
    applySignatureError = null;
    applySignatureSuccess = null;
    clearTimeout(applySignatureSuccessTimeout);
    try {
      const pdfjsDoc = await getCachedPdf(doc.id, doc.file);
      const ratios = await Promise.all(
        sourcePlacements.map((sig) => boxToRatio(pdfjsDoc, sourcePage, $editorStore.renderScale, doc.rotation, sig)),
      );

      const allPlacements = [];
      for (let page = 1; page <= doc.pageCount; page++) {
        if (page === sourcePage) {
          allPlacements.push(...sourcePlacements);
          continue;
        }
        const placed = await Promise.all(
          ratios.map((ratio, i) =>
            placementFromRatioForDocument(
              pdfjsDoc,
              page,
              $editorStore.renderScale,
              doc.rotation,
              ratio,
              sourcePlacements[i].signatureId,
            ),
          ),
        );
        allPlacements.push(...placed);
      }

      editorStore.applySignaturesToAllPages(allPlacements);
      applySignatureSuccess = `Applied to all ${doc.pageCount} pages`;
      applySignatureSuccessTimeout = setTimeout(() => (applySignatureSuccess = null), 2500);
    } catch (e) {
      applySignatureError = e instanceof Error ? e.message : 'Failed to apply signature to all pages';
    } finally {
      applyingSignatureToAllPages = false;
    }
  }

  // Applies the current placement's ratio to page 1 of every uploaded
  // document, so one signature placement can be affixed across a whole
  // batch of single-page PDFs at once. A document's real page count isn't
  // known until it's actually been opened (pageCount defaults to 1 until
  // then), so every document is loaded and checked here rather than trusting
  // the store's possibly-stale pageCount.
  async function applyToAllDocuments() {
    const ratio = $lastPlacement;
    const documents = $editorStore.documents;
    const signatureId = sig.activeId;
    if (!ratio || !signatureId) return;

    applyingToAll = true;
    applyToAllError = null;
    try {
      const pdfDocs = await Promise.all(documents.map((doc) => getCachedPdf(doc.id, doc.file)));
      const multiPage = documents.filter((_, i) => pdfDocs[i].numPages > 1).map((doc) => doc.file.name);

      if (multiPage.length > 0) {
        applyToAllError = `Skipped — not single-page: ${multiPage.join(', ')}`;
        return;
      }

      for (let i = 0; i < documents.length; i++) {
        const placement = await placementFromRatioForDocument(
          pdfDocs[i],
          1,
          $editorStore.renderScale,
          documents[i].rotation,
          ratio,
          signatureId,
        );
        const { id, ...rest } = placement;
        editorStore.setSignaturesForDocument(documents[i].id, [rest]);
      }
    } catch (e) {
      applyToAllError = e instanceof Error ? e.message : 'Failed to apply to all documents';
    } finally {
      applyingToAll = false;
    }
  }
</script>

{#if creatorOpen}
  <SignatureCreator onClose={() => (creatorOpen = false)} />
{/if}

<div>
  <div class="mb-3 flex items-center justify-between">
    <h3 class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
      Your Signature{sig.signatures.length > 1 ? 's' : ''}
    </h3>
    <button
      type="button"
      class="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
      onclick={() => (creatorOpen = true)}
    >
      + New Signature
    </button>
  </div>

  {#if sig.signature && sig.previewUrl}
    <div class="space-y-2">
      <div class="relative mx-auto w-fit">
        <button
          type="button"
          title="Drag onto the document. Resize using the handle after placing."
          class="block border-0 bg-transparent p-0"
          onclick={placeAtDefault}
          aria-label="Place signature on the document"
        >
          <img
            bind:clientHeight={sigImgHeight}
            src={sig.previewUrl}
            alt="Signature"
            draggable="true"
            class="block max-h-24 cursor-grab object-contain active:cursor-grabbing"
            ondragstart={(e) => onDragStart(e, sig.signature!.id)}
          />
        </button>

        {#if watermarkLines.length > 0 && sigImgHeight > 0}
          <div
            class="pointer-events-none absolute inset-0 flex overflow-hidden"
            style:align-items={watermarkAlign.vertical === 'top'
              ? 'flex-start'
              : watermarkAlign.vertical === 'bottom'
                ? 'flex-end'
                : 'center'}
            style:justify-content={watermarkAlign.horizontal === 'left'
              ? 'flex-start'
              : watermarkAlign.horizontal === 'right'
                ? 'flex-end'
                : 'center'}
            style:padding="{watermarkPreviewPadding}px"
          >
            <div
              style:color={$watermarkColor}
              style:opacity={$watermarkOpacity}
              style:font-size="{watermarkPreviewFontSize}px"
              style:line-height="{watermarkPreviewLineHeight}px"
              style:text-align={watermarkAlign.horizontal}
              class="font-sans"
            >
              {#each watermarkLines as line}
                <div>{line}</div>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <!-- Every saved signature: click to make it the one new placements use,
           drag any of them straight onto the page. -->
      <div class="grid grid-cols-3 gap-1.5" role="listbox" aria-label="Saved signatures">
        {#each sig.signatures as entry (entry.id)}
          {@const isActive = entry.id === sig.activeId}
          <div class="group relative">
            <button
              type="button"
              role="option"
              aria-selected={isActive}
              title="{entry.label} — click to use, or drag onto the page"
              class="flex h-12 w-full items-center justify-center rounded-lg border bg-white p-1 transition-colors
                {isActive
                ? 'border-blue-500 ring-2 ring-blue-400/40'
                : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-700 dark:hover:border-neutral-600'}"
              onclick={() => signatureStore.setActive(entry.id)}
            >
              <img
                src={entry.previewUrl}
                alt={entry.label}
                draggable="true"
                class="max-h-full max-w-full cursor-grab object-contain"
                ondragstart={(e) => onDragStart(e, entry.id)}
              />
            </button>
            <button
              type="button"
              aria-label="Delete {entry.label}"
              title="Delete this signature"
              class="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border
                border-white bg-neutral-500 text-white opacity-0 shadow transition-opacity hover:bg-red-600
                focus:opacity-100 group-hover:opacity-100 dark:border-neutral-900"
              onclick={() => requestDelete(entry.id)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="h-2.5 w-2.5">
                <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        {/each}
        <button
          type="button"
          aria-label="New signature"
          title="Draw, type, or upload another signature (e.g. your initials)"
          class="flex h-12 items-center justify-center rounded-lg border border-dashed border-neutral-300
            text-lg text-neutral-400 transition-colors hover:border-blue-400 hover:text-blue-500
            dark:border-neutral-700"
          onclick={() => (creatorOpen = true)}
        >
          +
        </button>
      </div>

      {#if pendingDelete}
        <div class="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900
          dark:bg-red-950/50 dark:text-red-300">
          <p>
            "{pendingDelete.label}" is placed {pendingDelete.uses} time{pendingDelete.uses > 1 ? 's' : ''}. Those
            will show your active signature instead.
          </p>
          <div class="mt-1.5 flex justify-end gap-3 font-medium">
            <button type="button" class="hover:underline" onclick={() => (pendingDelete = null)}>Cancel</button>
            <button type="button" class="text-red-600 hover:underline dark:text-red-400" onclick={confirmDelete}>
              Delete
            </button>
          </div>
        </div>
      {/if}

      <label class="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <input
          type="checkbox"
          bind:checked={$clickToPlaceMode}
          onchange={() => {
            if ($clickToPlaceMode) {
              textToolMode.set(false);
              zoomToolMode.set(false);
              textSelectMode.set(false);
              screenshotToolMode.set(false);
            }
          }}
          class="rounded"
        />
        Click-to-place mode
      </label>

      <button
        type="button"
        title="Best-effort scan of the document's text for a likely signature spot — always asks before placing anything"
        class="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700
          transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50
          dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        disabled={detectingSpot}
        onclick={findSpot}
      >
        {detectingSpot ? 'Scanning…' : 'Find Signature Spot'}
      </button>
      {#if detectSpotError}
        <p class="text-xs text-amber-600 dark:text-amber-400">{detectSpotError}</p>
      {/if}
    </div>

    {#if canUseLastPosition}
      <button
        type="button"
        class="mt-3 w-full rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium
          text-blue-600 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50
          dark:border-blue-700 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900"
        disabled={applyingLastPosition}
        onclick={useLastPosition}
      >
        {applyingLastPosition ? 'Placing…' : 'Use last position'}
      </button>
    {/if}

    {#if canApplySignatureToAllPages}
      <button
        type="button"
        title="Place the signature at this same spot on every page of this document"
        class="mt-3 w-full rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium
          text-blue-600 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50
          dark:border-blue-700 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900"
        disabled={applyingSignatureToAllPages}
        onclick={applySignatureToAllPages}
      >
        {applyingSignatureToAllPages ? 'Applying…' : `Apply Signature to All ${$activeDocument?.pageCount} Pages`}
      </button>
    {/if}
    {#if applySignatureError}
      <p class="mt-1 text-xs text-red-600 dark:text-red-400">{applySignatureError}</p>
    {:else if applySignatureSuccess}
      <p class="mt-1 text-xs text-emerald-600 dark:text-emerald-400">{applySignatureSuccess}</p>
    {/if}

    {#if $editorStore.documents.length > 1}
      <div class="mt-3">
        {#if $lastPlacement}
          <button
            type="button"
            title="Only works if every added PDF is a single page."
            class="w-full rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium
              text-blue-600 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50
              dark:border-blue-700 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900"
            disabled={applyingToAll || !allSinglePage}
            onclick={applyToAllDocuments}
          >
            {applyingToAll ? 'Applying…' : `Apply to All ${$editorStore.documents.length} Documents`}
          </button>
        {/if}
        {#if applyToAllError}
          <p class="mt-1 text-xs text-red-600 dark:text-red-400">{applyToAllError}</p>
        {/if}
      </div>
    {/if}

    <div class="mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <div class="mb-2 flex items-center justify-between">
        <h4 class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">Watermark</h4>
        <button
          type="button"
          aria-label={watermarkTextSaved ? 'Watermark text saved' : 'Save watermark text'}
          use:tooltip={watermarkTextSaved ? 'Saved' : 'Save this text for later'}
          disabled={!trimmedWatermarkText || watermarkTextSaved}
          class="flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:pointer-events-none
            hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100
            {watermarkTextSaved
            ? 'text-blue-500 dark:text-blue-400'
            : 'text-neutral-500 disabled:opacity-40 dark:text-neutral-400'}"
          onclick={() => saveWatermarkText($watermarkText)}
        >
          <svg
            viewBox="0 0 24 24"
            fill={watermarkTextSaved ? 'currentColor' : 'none'}
            stroke="currentColor"
            stroke-width="2"
            class="h-3.5 w-3.5"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 3h12v18l-6-4-6 4V3Z" />
          </svg>
        </button>
      </div>

      <textarea
        id="watermark-text"
        aria-label="Watermark text"
        rows="3"
        placeholder="e.g. Jane Doe&#10;Contract #123"
        class="w-full resize-none rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm
          focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400
          dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        bind:value={$watermarkText}
      ></textarea>

      {#if $savedWatermarkTexts.length > 0}
        <div class="mt-1.5 flex flex-wrap gap-1" aria-label="Saved watermark texts">
          {#each $savedWatermarkTexts as text (text)}
            {@const active = text === trimmedWatermarkText}
            <span
              class="group flex max-w-full items-center rounded-full border text-xs transition-colors {active
                ? 'border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-950 dark:text-blue-300'
                : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
            >
              <button
                type="button"
                class="min-w-0 truncate py-0.5 pl-2 pr-1"
                use:tooltip={text}
                onclick={() => watermarkText.set(text)}
              >
                {text.split('\n')[0]}{text.includes('\n') ? ' …' : ''}
              </button>
              <button
                type="button"
                aria-label="Remove saved text"
                class="mr-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-neutral-400
                  opacity-0 transition-opacity hover:bg-neutral-200 hover:text-neutral-700 focus:opacity-100
                  group-hover:opacity-100 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                onclick={() => removeSavedWatermarkText(text)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-2.5 w-2.5">
                  <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </span>
          {/each}
        </div>
      {/if}

      <label class="mt-2 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <input type="checkbox" bind:checked={$includeTimestamp} class="rounded" />
        Stamp current date &amp; time
      </label>

      <div class="mt-3 flex items-start justify-between gap-4">
        <div>
          <p class="mb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">Position</p>
          <div class="grid w-16 grid-cols-3 gap-1">
            {#each POSITIONS as pos}
              <button
                type="button"
                aria-label={pos}
                class="h-5 w-5 rounded border transition-colors"
                class:border-blue-500={$watermarkPosition === pos}
                class:bg-blue-500={$watermarkPosition === pos}
                class:border-neutral-300={$watermarkPosition !== pos}
                class:dark:border-neutral-600={$watermarkPosition !== pos}
                onclick={() => watermarkPosition.set(pos)}
              ></button>
            {/each}
          </div>
        </div>

        <div>
          <label for="watermark-color" class="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Color
          </label>
          <input
            id="watermark-color"
            type="color"
            bind:value={$watermarkColor}
            class="h-6 w-8 cursor-pointer rounded border border-neutral-300 bg-transparent p-0
              dark:border-neutral-600"
          />
        </div>
      </div>

      <p class="mb-1 mt-3 block text-xs font-medium text-neutral-500 dark:text-neutral-400">Size</p>
      <input
        type="range"
        min={WATERMARK_FONT_SCALE_MIN}
        max={WATERMARK_FONT_SCALE_MAX}
        step={WATERMARK_FONT_SCALE_STEP}
        bind:value={$watermarkFontScale}
        use:wheelRange
        class="w-full accent-blue-600"
      />

      <p class="mb-1 mt-3 block text-xs font-medium text-neutral-500 dark:text-neutral-400">Opacity</p>
      <input
        type="range"
        min={WATERMARK_OPACITY_MIN}
        max={WATERMARK_OPACITY_MAX}
        step={WATERMARK_OPACITY_STEP}
        bind:value={$watermarkOpacity}
        use:wheelRange
        class="w-full accent-blue-600"
      />
    </div>
  {:else if !sig.loading}
    <button
      type="button"
      class="flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed border-neutral-300 px-3 py-5
        text-center transition-colors hover:border-blue-400 hover:bg-blue-50/50 dark:border-neutral-700
        dark:hover:bg-blue-950/30"
      onclick={() => (creatorOpen = true)}
    >
      <span class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Add your signature</span>
      <span class="text-xs text-neutral-500 dark:text-neutral-400">Draw, type, or upload a scan</span>
    </button>
    <p class="mt-2 text-xs text-neutral-400">
      Signing is optional — use Redact below the document if that's all you need.
    </p>
  {/if}
</div>
