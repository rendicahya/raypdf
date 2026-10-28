<script lang="ts">
  import { editorStore, activeDocument, type PdfDocumentState } from '../stores/editor';
  import { signatureStore } from '../stores/signature';
  import { currentWatermarkOptions } from '../stores/watermark';
  import {
    stripEmbeddedScripts,
    securePdf,
    passwordProtect,
    savePassword,
    currentSaveProtection,
    compressionLevel,
  } from '../stores/exportOptions';
  import {
    exportSignedPdf,
    downloadSignedPdf,
    downloadPageOnlyPdf,
    exportPagesAsZip,
    downloadPagesZip,
    exportAllAsZip,
    downloadZip,
    exportMergedPdf,
    downloadMergedPdf,
    hasDocumentEdits,
    printPdfBytes,
    downloadCompressedPdf,
  } from '../lib/pdf/export';
  import { compressPdf, COMPRESSION_LEVELS, type CompressionLevel } from '../lib/pdf/compress';
  import { getCachedPdf } from '../lib/pdf/docCache';
  import { downloadAllImages, type Rect } from '../lib/pdf/embeddedImages';
  import { downloadPagesAsImages, type PageImageFormat } from '../lib/pdf/pageImages';
import { applyProtection, hasProtection } from '../lib/pdf/password';
  import { formatFileSize } from '../lib/utils/fileValidation';
  import MergeOrderDialog from './MergeOrderDialog.svelte';
  import { tooltip } from '../lib/utils/tooltip';

  let exportingOne = $state(false);
  let compressing = $state(false);
  let compressNote: string | null = $state(null);
  let compressNoteTimeout: ReturnType<typeof setTimeout> | undefined;
  let convertingDocx = $state(false);
  let savingImages = $state(false);
  let savingPageImages: PageImageFormat | null = $state(null);
  let exportingPageOnly = $state(false);
  let exportingPagesZip = $state(false);
  let exportingAll = $state(false);
  let printing = $state(false);
  let showMergeDialog = $state(false);
  let showSaveMenu = $state(false);
  let merging = $state(false);
  let showPassword = $state(false);
  let error: string | null = $state(null);

  const currentWatermark = currentWatermarkOptions;

  // Signing and redacting are independent — resolves whichever of the two
  // this document actually has, and (unless allowUnedited, as for printing)
  // only errors if it has neither.
  async function resolveExportInputs(doc: PdfDocumentState, allowUnedited = false) {
    const sig = $signatureStore;
    // Only signatures the user actually placed — never an implied position.
    const placements = sig.signature ? doc.placedSignatures : [];

    if (!allowUnedited && placements.length === 0 && !hasDocumentEdits(doc)) {
      throw new Error(
        'Nothing to export yet. Place a signature, fill in a form, edit the pages, or add a redaction, text, or comment first.',
      );
    }

    return {
      placements: placements.length > 0 ? placements : undefined,
      signatureFor: placements.length > 0 ? (signatureStore.lookup() ?? undefined) : undefined,
    };
  }

  async function onExportOne() {
    const doc = $activeDocument;
    if (!doc) return;

    exportingOne = true;
    error = null;
    try {
      const { placements, signatureFor } = await resolveExportInputs(doc);

      const bytes = await exportSignedPdf({
        pdfFile: doc.file,
        documentId: doc.id,
        signatureFor,
        placements,
        renderScale: $editorStore.renderScale,
        rotation: doc.rotation,
        watermark: currentWatermark(),
        stripScripts: $stripEmbeddedScripts,
        redactions: doc.redactions,
        texts: doc.texts,
        comments: doc.comments,
        highlights: doc.highlights,
        shapes: doc.shapes,
        images: doc.images,
        formValues: doc.formValues,
        pageNumbers: doc.pageNumbers,
        headerFooter: doc.headerFooter,
        pageWatermark: doc.pageWatermark,
        protection: currentSaveProtection(),
      });
      downloadSignedPdf(bytes, doc.file.name);
      editorStore.markDocumentExported(doc.id);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Export failed';
    } finally {
      exportingOne = false;
    }
  }

  // Saves everything added, like Save, then shrinks the result. Unlike Save it
  // also works on an untouched PDF, since making a file smaller is reason
  // enough to save it.
  async function onExportCompressed(level: CompressionLevel) {
    const doc = $activeDocument;
    if (!doc) return;
    $compressionLevel = level;

    compressing = true;
    error = null;
    compressNote = null;
    clearTimeout(compressNoteTimeout);
    try {
      const protection = currentSaveProtection();
      const placements = $signatureStore.signature ? doc.placedSignatures : [];
      const bytes = await exportSignedPdf({
        pdfFile: doc.file,
        documentId: doc.id,
        signatureFor: placements.length > 0 ? (signatureStore.lookup() ?? undefined) : undefined,
        placements: placements.length > 0 ? placements : undefined,
        renderScale: $editorStore.renderScale,
        rotation: doc.rotation,
        watermark: currentWatermark(),
        stripScripts: $stripEmbeddedScripts,
        redactions: doc.redactions,
        texts: doc.texts,
        comments: doc.comments,
        highlights: doc.highlights,
        shapes: doc.shapes,
        images: doc.images,
        formValues: doc.formValues,
        pageNumbers: doc.pageNumbers,
        headerFooter: doc.headerFooter,
        pageWatermark: doc.pageWatermark,
      });
      // Protected after compressing: an encrypted file can't be rewritten.
      const result = await compressPdf(
        bytes,
        hasProtection(protection) ? (d) => applyProtection(d, protection) : undefined,
        level,
      );
      downloadCompressedPdf(result.bytes, doc.file.name);
      editorStore.markDocumentExported(doc.id);

      const before = doc.file.size;
      const saved = 1 - result.compressedSize / before;
      compressNote =
        saved >= 0.01
          ? `${formatFileSize(before)} → ${formatFileSize(result.compressedSize)} (${Math.round(saved * 100)}% smaller)`
          : `Already compact: ${formatFileSize(result.compressedSize)}`;
      compressNoteTimeout = setTimeout(() => (compressNote = null), 6000);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Compression failed';
    } finally {
      compressing = false;
    }
  }

  // Saves everything added, like Save, then rebuilds it as a Word document.
  // Works on an untouched PDF too; no password, since Word can't open one.
  async function onExportDocx() {
    const doc = $activeDocument;
    if (!doc) return;

    convertingDocx = true;
    error = null;
    try {
      const placements = $signatureStore.signature ? doc.placedSignatures : [];
      const bytes = await exportSignedPdf({
        pdfFile: doc.file,
        documentId: doc.id,
        signatureFor: placements.length > 0 ? (signatureStore.lookup() ?? undefined) : undefined,
        placements: placements.length > 0 ? placements : undefined,
        renderScale: $editorStore.renderScale,
        rotation: doc.rotation,
        watermark: currentWatermark(),
        stripScripts: $stripEmbeddedScripts,
        redactions: doc.redactions,
        texts: doc.texts,
        comments: doc.comments,
        highlights: doc.highlights,
        shapes: doc.shapes,
        images: doc.images,
        formValues: doc.formValues,
        pageNumbers: doc.pageNumbers,
        headerFooter: doc.headerFooter,
        pageWatermark: doc.pageWatermark,
      });
      // Loaded on first use, so the Word writer isn't in the main bundle.
      const { downloadPdfAsDocx } = await import('../lib/pdf/docx');
      await downloadPdfAsDocx(bytes, doc.file.name);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Conversion failed';
    } finally {
      convertingDocx = false;
    }
  }

  // The pictures in the file as opened, at their stored resolution; anything
  // under a redaction box is left out, as it would be from the saved PDF.
  async function onSaveImages() {
    const doc = $activeDocument;
    if (!doc) return;

    savingImages = true;
    error = null;
    try {
      const scale = $editorStore.renderScale;
      const redacted = (page: number, image: Rect) =>
        doc.redactions.some(
          (r) =>
            r.page === page &&
            r.x / scale < image.x + image.width &&
            (r.x + r.width) / scale > image.x &&
            r.y / scale < image.y + image.height &&
            (r.y + r.height) / scale > image.y,
        );
      const pdfDoc = await getCachedPdf(doc.id, doc.file);
      const count = await downloadAllImages(pdfDoc, doc.file, doc.rotation, redacted);
      if (count === 0) error = 'No pictures found in this document.';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to save the images';
    } finally {
      savingImages = false;
    }
  }

  // Every page with everything added, rendered as an image like the
  // thumbnail menu's "Save page as". No comments: a sticky note would only
  // show as an icon. No password either, since an image can't carry one.
  async function onSavePagesAsImages(format: PageImageFormat) {
    const doc = $activeDocument;
    if (!doc) return;

    savingPageImages = format;
    error = null;
    try {
      const placements = $signatureStore.signature ? doc.placedSignatures : [];
      const bytes = await exportSignedPdf({
        pdfFile: doc.file,
        documentId: doc.id,
        signatureFor: placements.length > 0 ? (signatureStore.lookup() ?? undefined) : undefined,
        placements: placements.length > 0 ? placements : undefined,
        renderScale: $editorStore.renderScale,
        rotation: doc.rotation,
        watermark: currentWatermark(),
        stripScripts: $stripEmbeddedScripts,
        redactions: doc.redactions,
        texts: doc.texts,
        comments: [],
        highlights: doc.highlights,
        shapes: doc.shapes,
        images: doc.images,
        formValues: doc.formValues,
        pageNumbers: doc.pageNumbers,
        headerFooter: doc.headerFooter,
        pageWatermark: doc.pageWatermark,
      });
      const pages = Array.from({ length: doc.pageCount }, (_, i) => i + 1);
      await downloadPagesAsImages(bytes, doc.file.name, pages, format);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to save the pages as images';
    } finally {
      savingPageImages = null;
    }
  }

  async function onExportPageOnly() {
    const doc = $activeDocument;
    if (!doc) return;

    exportingPageOnly = true;
    error = null;
    try {
      const { placements, signatureFor } = await resolveExportInputs(doc);

      const bytes = await exportSignedPdf({
        pdfFile: doc.file,
        documentId: doc.id,
        signatureFor,
        placements,
        renderScale: $editorStore.renderScale,
        rotation: doc.rotation,
        watermark: currentWatermark(),
        stripScripts: $stripEmbeddedScripts,
        redactions: doc.redactions,
        texts: doc.texts,
        comments: doc.comments,
        highlights: doc.highlights,
        shapes: doc.shapes,
        images: doc.images,
        formValues: doc.formValues,
        pageNumbers: doc.pageNumbers,
        headerFooter: doc.headerFooter,
        pageWatermark: doc.pageWatermark,
        onlyPages: [doc.pageNumber],
        protection: currentSaveProtection(),
      });
      downloadPageOnlyPdf(bytes, doc.file.name, doc.pageNumber);
      editorStore.markDocumentExported(doc.id);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Export failed';
    } finally {
      exportingPageOnly = false;
    }
  }

  async function onExportPagesZip() {
    const doc = $activeDocument;
    if (!doc) return;

    exportingPagesZip = true;
    error = null;
    try {
      const { placements, signatureFor } = await resolveExportInputs(doc);

      const blob = await exportPagesAsZip(
        doc,
        signatureFor,
        placements,
        $editorStore.renderScale,
        doc.rotation,
        currentWatermark(),
        $stripEmbeddedScripts,
        currentSaveProtection(),
      );
      downloadPagesZip(blob, doc.file.name);
      editorStore.markDocumentExported(doc.id);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Export failed';
    } finally {
      exportingPagesZip = false;
    }
  }

  async function onPrint() {
    const doc = $activeDocument;
    if (!doc) return;

    printing = true;
    error = null;
    try {
      // Printing an untouched PDF is a reason in itself.
      const { placements, signatureFor } = await resolveExportInputs(doc, true);

      const bytes = await exportSignedPdf({
        pdfFile: doc.file,
        documentId: doc.id,
        signatureFor,
        placements,
        renderScale: $editorStore.renderScale,
        rotation: doc.rotation,
        watermark: currentWatermark(),
        stripScripts: $stripEmbeddedScripts,
        redactions: doc.redactions,
        texts: doc.texts,
        comments: doc.comments,
        highlights: doc.highlights,
        shapes: doc.shapes,
        images: doc.images,
        formValues: doc.formValues,
        pageNumbers: doc.pageNumbers,
        headerFooter: doc.headerFooter,
        pageWatermark: doc.pageWatermark,
        // A password would make the print dialog ask for it, so printing only keeps the copy lock.
        protection: { lockCopying: $securePdf },
      });
      printPdfBytes(bytes);
      editorStore.markDocumentExported(doc.id);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Print failed';
    } finally {
      printing = false;
    }
  }

  // Ctrl/Cmd+P prints the PDF with everything added, not the editor page.
  function onKeydown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'p') return;
    e.preventDefault();
    if (!printing) onPrint();
  }

  async function onExportAll() {
    const documents = $editorStore.documents;

    if (documents.length === 0) {
      error = 'Add a PDF first.';
      return;
    }

    exportingAll = true;
    error = null;
    try {
      const result = await exportAllAsZip(
        documents,
        signatureStore.lookup(),
        $editorStore.renderScale,
        currentWatermark(),
        $stripEmbeddedScripts,
        currentSaveProtection(),
      );

      if (result.exportedCount === 0) {
        error = 'Place a signature or draw a redaction on at least one document first.';
        return;
      }

      downloadZip(result.zipBlob);
      documents
        .filter((doc) => !result.skipped.includes(doc.file.name))
        .forEach((doc) => editorStore.markDocumentExported(doc.id));
      error =
        result.skipped.length > 0
          ? `Skipped (nothing to export): ${result.skipped.join(', ')}`
          : null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Export failed';
    } finally {
      exportingAll = false;
    }
  }

  function onOpenMergeDialog() {
    error = null;
    showSaveMenu = false;
    showMergeDialog = true;
  }

  function onCancelMerge() {
    showMergeDialog = false;
  }

  async function onConfirmMerge(orderedIds: string[]) {
    const documents = $editorStore.documents;

    merging = true;
    error = null;
    try {
      const bytes = await exportMergedPdf(
        documents,
        orderedIds,
        signatureStore.lookup(),
        $editorStore.renderScale,
        currentWatermark(),
        $stripEmbeddedScripts,
        currentSaveProtection(),
      );
      downloadMergedPdf(bytes);
      documents.forEach((doc) => editorStore.markDocumentExported(doc.id));
      showMergeDialog = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Merge failed';
    } finally {
      merging = false;
    }
  }
</script>

<!-- Lives in the top Toolbar: Save is always one click away, whether or not
     the Signature panel is open. The chevron menu holds the other ways to
     save, grouped by output format, plus the export options. -->
{#snippet heading(label: string, divider: boolean)}
  <div
    role="presentation"
    class="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400
      {divider ? 'mt-1 border-t border-neutral-200 dark:border-neutral-700' : ''}"
  >
    {label}
  </div>
{/snippet}

<svelte:window onkeydown={onKeydown} />

<div class="relative flex items-center gap-1">
  <div class="flex overflow-hidden rounded-lg">
    <button
      type="button"
      class="flex items-center gap-1.5 bg-blue-600 px-3 py-1 text-sm font-medium text-white transition-colors
        hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={exportingOne}
      use:tooltip={$passwordProtect
        ? 'Save this PDF with everything you added, protected with your password'
        : 'Save this PDF with everything you added'}
      onclick={onExportOne}
    >
      {#if $passwordProtect}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />
        </svg>
      {/if}
      {exportingOne ? 'Saving…' : 'Save'}
    </button>
    <button
      type="button"
      aria-label="More save options"
      aria-haspopup="true"
      aria-expanded={showSaveMenu}
      class="flex w-7 shrink-0 items-center justify-center border-l border-blue-700/40 bg-blue-600
        text-white transition-colors hover:bg-blue-700"
      onclick={() => (showSaveMenu = !showSaveMenu)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
        <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
      </svg>
    </button>
  </div>

  <button
    type="button"
    aria-label="Print this PDF"
    aria-keyshortcuts="Control+P"
    use:tooltip={'Print this PDF (Ctrl+P)'}
    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors
      hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-50
      dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
    disabled={printing}
    onclick={onPrint}
  >
    {#if printing}
      <svg viewBox="0 0 24 24" fill="none" class="h-3.5 w-3.5 animate-spin text-neutral-400">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" opacity="0.25" />
        <path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M21 12a9 9 0 0 0-9-9" />
      </svg>
    {:else}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 9V3h12v6" />
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"
        />
        <rect x="6" y="14" width="12" height="7" rx="1" />
      </svg>
    {/if}
  </button>

  {#if showSaveMenu}
    <button
      type="button"
      class="fixed inset-0 z-30 cursor-default"
      aria-label="Close save options"
      onclick={() => (showSaveMenu = false)}
    ></button>
    <div
      role="menu"
      class="absolute right-0 top-full z-40 mt-1 max-h-[calc(100vh-4rem)] w-72 overflow-y-auto rounded-lg border
        border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
    >
      {@render heading('PDF', false)}
      <div class="px-3 py-2 text-sm text-neutral-700 dark:text-neutral-200">
        <span class="block">{compressing ? 'Compressing…' : 'Save compressed'}</span>
        <span class="block text-xs text-neutral-400">Smaller file: images are scaled down and re-encoded</span>
        <div class="mt-1.5 flex gap-1.5">
          {#each Object.entries(COMPRESSION_LEVELS) as [level, settings] (level)}
            <button
              type="button"
              role="menuitem"
              aria-label={`Save compressed, ${settings.label.toLowerCase()} compression`}
              use:tooltip={settings.description}
              class="flex-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors
                disabled:cursor-not-allowed disabled:opacity-50
                {$compressionLevel === level
                ? 'border-blue-500 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50'
                : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'}"
              disabled={compressing}
              onclick={() => {
                showSaveMenu = false;
                onExportCompressed(level as CompressionLevel);
              }}
            >
              {settings.label}
            </button>
          {/each}
        </div>
      </div>

      {#if ($activeDocument?.pageCount ?? 1) > 1}
        <button
          type="button"
          role="menuitem"
          class="block w-full px-3 py-2 text-left text-sm text-neutral-700 transition-colors
            hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50
            dark:text-neutral-200 dark:hover:bg-neutral-800"
          disabled={exportingPageOnly}
          onclick={() => {
            showSaveMenu = false;
            onExportPageOnly();
          }}
        >
          {exportingPageOnly ? 'Saving…' : `Save this page only (${$activeDocument?.pageNumber ?? 1})`}
        </button>

        <button
          type="button"
          role="menuitem"
          class="block w-full px-3 py-2 text-left text-sm text-neutral-700 transition-colors
            hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50
            dark:text-neutral-200 dark:hover:bg-neutral-800"
          disabled={exportingPagesZip}
          onclick={() => {
            showSaveMenu = false;
            onExportPagesZip();
          }}
        >
          {exportingPagesZip ? 'Zipping…' : 'Save each page as a separate PDF (ZIP)'}
        </button>
      {/if}

      {#if $editorStore.documents.length > 1}
        <button
          type="button"
          role="menuitem"
          class="block w-full px-3 py-2 text-left text-sm text-neutral-700 transition-colors
            hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50
            dark:text-neutral-200 dark:hover:bg-neutral-800"
          disabled={exportingAll}
          onclick={() => {
            showSaveMenu = false;
            onExportAll();
          }}
        >
          {exportingAll ? 'Zipping…' : 'Save all (ZIP)'}
        </button>

        <button
          type="button"
          role="menuitem"
          class="block w-full px-3 py-2 text-left text-sm text-neutral-700 transition-colors
            hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50
            dark:text-neutral-200 dark:hover:bg-neutral-800"
          disabled={merging}
          onclick={onOpenMergeDialog}
        >
          Save all as one PDF
        </button>
      {/if}

      {@render heading('Image', true)}
      <button
        type="button"
        role="menuitem"
        class="block w-full px-3 py-2 text-left text-sm text-neutral-700 transition-colors
          hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50
          dark:text-neutral-200 dark:hover:bg-neutral-800"
        disabled={savingImages}
        onclick={() => {
          showSaveMenu = false;
          onSaveImages();
        }}
      >
        <span class="block">{savingImages ? 'Saving images…' : 'Save all images'}</span>
        <span class="block text-xs text-neutral-400">Every picture in the PDF at full resolution (ZIP)</span>
      </button>

      <div class="flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-200">
        <span class="min-w-0 flex-1">
          <span class="block">{savingPageImages ? 'Rendering pages…' : 'Save pages as images'}</span>
          <span class="block text-xs text-neutral-400">
            {($activeDocument?.pageCount ?? 1) > 1 ? 'One image per page (ZIP)' : 'The page as one image'}
          </span>
        </span>
        {#each ['png', 'jpg'] as const as format (format)}
          <button
            type="button"
            role="menuitem"
            aria-label={`Save pages as ${format.toUpperCase()} images`}
            class="shrink-0 rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium transition-colors
              hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50
              dark:border-neutral-700 dark:hover:bg-neutral-800"
            disabled={savingPageImages !== null}
            onclick={() => {
              showSaveMenu = false;
              onSavePagesAsImages(format);
            }}
          >
            {format.toUpperCase()}
          </button>
        {/each}
      </div>

      {@render heading('Word', true)}
      <button
        type="button"
        role="menuitem"
        class="block w-full px-3 py-2 text-left text-sm text-neutral-700 transition-colors
          hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50
          dark:text-neutral-200 dark:hover:bg-neutral-800"
        disabled={convertingDocx}
        onclick={() => {
          showSaveMenu = false;
          onExportDocx();
        }}
      >
        <span class="block">{convertingDocx ? 'Converting…' : 'Save as Word (.docx)'}</span>
        <span class="block text-xs text-neutral-400">Editable text and pictures; tables and columns may shift</span>
      </button>

      <div class="mt-1 flex flex-col gap-2 border-t border-neutral-200 px-3 py-2 pt-3 dark:border-neutral-700">
        <label class="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-400">
          <input
            type="checkbox"
            class="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-neutral-300 text-blue-600
              focus:ring-blue-500 dark:border-neutral-600"
            bind:checked={$stripEmbeddedScripts}
          />
          <span>Strip embedded JavaScript from the PDF</span>
        </label>

        <label class="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-400">
          <input
            type="checkbox"
            class="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-neutral-300 text-blue-600
              focus:ring-blue-500 dark:border-neutral-600"
            bind:checked={$securePdf}
          />
          <span>Secure PDF (disable text/content copying)</span>
        </label>

        <label class="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-400">
          <input
            type="checkbox"
            class="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-neutral-300 text-blue-600
              focus:ring-blue-500 dark:border-neutral-600"
            bind:checked={$passwordProtect}
          />
          <span>Require a password to open</span>
        </label>
        {#if $passwordProtect}
          <div class="ml-5 flex flex-col gap-1">
            <div class="flex items-center gap-1">
              <!-- svelte-ignore a11y_autofocus -->
              <input
                type={showPassword ? 'text' : 'password'}
                autocomplete="new-password"
                placeholder="Password"
                aria-label="Password for the saved PDF"
                autofocus
                class="min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-xs
                  focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-neutral-700 dark:bg-neutral-900"
                bind:value={$savePassword}
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                use:tooltip={showPassword ? 'Hide password' : 'Show password'}
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400
                  hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                onclick={() => (showPassword = !showPassword)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                  {#if showPassword}
                    <path stroke-linecap="round" d="M4 4l16 16" />
                  {/if}
                </svg>
              </button>
            </div>
            <span class="text-[11px] leading-snug text-neutral-400">
              Saved PDFs will ask for it. It isn't stored, and there is no way to recover it.
            </span>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if compressNote && !error}
    <div
      role="status"
      class="absolute right-0 top-full z-30 mt-1 flex w-72 items-start gap-2 rounded-lg border border-emerald-200
        bg-emerald-50 px-3 py-2 text-xs text-emerald-700 shadow dark:border-emerald-900 dark:bg-emerald-950
        dark:text-emerald-300"
    >
      <span class="flex-1">Saved compressed. {compressNote}</span>
      <button type="button" aria-label="Dismiss" class="shrink-0" onclick={() => (compressNote = null)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3 w-3">
          <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  {/if}

  {#if error}
    <div
      role="alert"
      class="absolute right-0 top-full z-30 mt-1 flex w-72 items-start gap-2 rounded-lg border border-red-200
        bg-red-50 px-3 py-2 text-xs text-red-700 shadow dark:border-red-900 dark:bg-red-950 dark:text-red-300"
    >
      <span class="flex-1">{error}</span>
      <button type="button" aria-label="Dismiss" class="shrink-0 hover:text-red-900" onclick={() => (error = null)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3 w-3">
          <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  {/if}
</div>

{#if showMergeDialog}
  <MergeOrderDialog
    documents={$editorStore.documents.map((doc) => ({ id: doc.id, name: doc.file.name }))}
    {merging}
    onConfirm={onConfirmMerge}
    onCancel={onCancelMerge}
  />
{/if}
