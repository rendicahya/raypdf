<script lang="ts">
  import { signatureStore } from '../stores/signature';
  import { editorStore, activeDocument } from '../stores/editor';
  import { lastPlacement } from '../stores/placement';
  import { clickToPlaceMode } from '../stores/clickToPlace';
  import { textToolMode } from '../stores/textTool';
  import { zoomToolMode } from '../stores/zoomTool';
  import { textSelectMode } from '../stores/textSelect';
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
  } from '../stores/watermark';
  import { buildWatermarkLines, parsePosition } from '../lib/watermark/visible';
  import { fitWithinBox } from '../lib/signature/layout';
  import { getCachedPdf } from '../lib/pdf/docCache';
  import { boxToRatio, placementFromRatioForDocument } from '../lib/pdf/placement';
  import { findSignatureSpot } from '../lib/pdf/signatureDetect';
  import { signatureSuggestion } from '../stores/signatureSuggestion';
  import { isFileAccepted, formatFileSize, MAX_SIGNATURE_SIZE_BYTES } from '../lib/utils/fileValidation';

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

  let replaceError: string | null = $state(null);

  async function onReplace(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (!isFileAccepted(file, 'image/*')) {
      replaceError = 'Please choose an image file.';
      return;
    }

    if (file.size > MAX_SIGNATURE_SIZE_BYTES) {
      replaceError = `"${file.name}" is ${formatFileSize(file.size)} — the limit is ${formatFileSize(MAX_SIGNATURE_SIZE_BYTES)}.`;
      return;
    }

    replaceError = null;
    await signatureStore.upload(file);
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

  function onDragStart(e: DragEvent) {
    e.dataTransfer?.setData('text/plain', 'signature');
  }

  function placeAtDefault() {
    // Simple click-to-place fallback for non-drag interactions (e.g. touch).
    const doc = $activeDocument;
    if (!doc) return;
    const { width, height } = fitWithinBox(sig.naturalWidth, sig.naturalHeight);
    // Cascade position so repeated clicks don't stack exactly on top of each other.
    const offset = (doc.placedSignatures.length % 6) * 24;
    editorStore.addSignature({ x: 40 + offset, y: 40 + offset, width, height, page: doc.pageNumber });
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
    if (!doc || !ratio) return;

    applyingLastPosition = true;
    try {
      const pdfjsDoc = await getCachedPdf(doc.id, doc.file);
      const placement = await placementFromRatioForDocument(
        pdfjsDoc,
        doc.pageNumber,
        $editorStore.renderScale,
        doc.rotation,
        ratio,
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
          ratios.map((ratio) => placementFromRatioForDocument(pdfjsDoc, page, $editorStore.renderScale, doc.rotation, ratio)),
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
    if (!ratio) return;

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

<div>
  <div class="mb-3 flex items-center justify-between">
    <h3 class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">Your Signature</h3>
    <label class="cursor-pointer text-xs font-medium text-blue-600 hover:underline dark:text-blue-400">
      {sig.signature ? 'Replace Signature' : 'Add Signature'}
      <input type="file" accept="image/*" class="hidden" onchange={onReplace} />
    </label>
  </div>

  {#if replaceError}
    <p class="mb-2 text-xs text-red-600 dark:text-red-400">{replaceError}</p>
  {/if}

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
            ondragstart={onDragStart}
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

      <label class="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <input
          type="checkbox"
          bind:checked={$clickToPlaceMode}
          onchange={() => {
            if ($clickToPlaceMode) {
              textToolMode.set(false);
              zoomToolMode.set(false);
              textSelectMode.set(false);
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
      <h4 class="mb-2 text-sm font-semibold text-neutral-600 dark:text-neutral-300">Watermark</h4>

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
        class="w-full accent-blue-600"
      />

      <p class="mb-1 mt-3 block text-xs font-medium text-neutral-500 dark:text-neutral-400">Opacity</p>
      <input
        type="range"
        min={WATERMARK_OPACITY_MIN}
        max={WATERMARK_OPACITY_MAX}
        step={WATERMARK_OPACITY_STEP}
        bind:value={$watermarkOpacity}
        class="w-full accent-blue-600"
      />
    </div>
  {:else}
    <p class="text-xs text-neutral-400">
      No signature saved yet — add one above to sign, or use Redact below the document if that's all you need.
    </p>
  {/if}
</div>
