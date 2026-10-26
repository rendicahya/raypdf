import { PDFDocument, PDFString, degrees } from '@cantoo/pdf-lib';
import JSZip from 'jszip';
import { loadPdf, getTotalRotation, type PdfDocument } from './loader';
import { fillFormFields, type FormValues } from './forms';
import { stripEmbeddedScripts } from './sanitize';
import { applyRedactions } from './redact';
import { applyVisibleWatermark, type WatermarkOptions } from '../watermark/visible';
import { drawTextBox, embedTextFont, hexToRgb } from './textRender';
import { embedVerificationRecord } from './verification';
import { embedHighlightAnnotations } from './highlight';
import { drawPageLabels, type PageNumberSettings } from './pageNumbers';
import { headerFooterDate, pageLabels, type HeaderFooterSettings } from './headerFooter';
import { drawPageWatermark, type PageWatermarkSettings } from './pageWatermark';
import { applyProtection, loadEditablePdf, type SaveProtection } from './password';
import { drawImages, drawShapes } from './shapes';
import { imageFor } from '../../stores/images';
import type {
  PdfDocumentState,
  PlacedComment,
  PlacedHighlight,
  PlacedImage,
  PlacedShape,
  PlacedSignature,
  PlacedText,
  RedactionBox,
} from '../../stores/editor';

/** The image for a placement's saved signature (PlacedSignature.signatureId), or undefined to skip it. */
export type SignatureLookup = (signatureId: string) => Blob | undefined;

export interface ExportParams {
  pdfFile: File;
  /** Stable per-document id (PdfDocumentState.id) — embedded so the Verify page can identify this export later. */
  documentId: string;
  /** Present only if signatures should be drawn onto the pages — signing is optional now that redaction can stand alone. */
  signatureFor?: SignatureLookup;
  placements?: PlacedSignature[];
  /** Canvas render scale used by PDFViewer, needed to map pixels back to PDF points. */
  renderScale: number;
  /** Additional rotation (0/90/180/270) the user chose in the editor, on top of each page's own rotation. */
  rotation?: number;
  watermark?: WatermarkOptions;
  /** Strip any embedded JavaScript/auto-run actions carried over from the source PDF. Opt-in — see `lib/pdf/sanitize.ts`. */
  stripScripts?: boolean;
  /** Areas to permanently strip from the exported PDF before the signature is drawn. */
  redactions?: RedactionBox[];
  /** Typed text boxes to draw onto the exported PDF. */
  texts?: PlacedText[];
  /** Sticky-note comments to embed as real PDF annotations (not drawn onto the page content). */
  comments?: PlacedComment[];
  /** Text highlights to embed as PDF Highlight annotations. */
  highlights?: PlacedHighlight[];
  /** Drawn shapes and placed images, drawn under signatures and text. */
  shapes?: PlacedShape[];
  images?: PlacedImage[];
  /** If set, the exported PDF contains only these 1-indexed pages, in this order (with any placements/redactions/text still applied), instead of every page. */
  onlyPages?: number[];
  /** A password to open the saved file and/or locked copying — see `applyProtection`. */
  protection?: SaveProtection;
  /** Values the user entered into the PDF's own form fields, by field name — see `lib/pdf/forms.ts`. */
  formValues?: FormValues;
  /** Numbers to draw on the pages, if any — see `lib/pdf/pageNumbers.ts`. */
  pageNumbers?: PageNumberSettings | null;
  /** Header and footer text, if any — see `lib/pdf/headerFooter.ts`. */
  headerFooter?: HeaderFooterSettings | null;
  /** Text or a picture stamped across the pages, if any (see `lib/pdf/pageWatermark.ts`). */
  pageWatermark?: PageWatermarkSettings | null;
}

function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
}

/**
 * Embeds each comment as a real PDF "Text" (sticky note) annotation rather
 * than drawing anything onto the page content — compliant readers (Acrobat,
 * etc.) render their own note icon at the given Rect and show `text` in the
 * annotation's popup, so the note stays out of the page's visible content
 * and out of the redaction/flatten path above.
 */
async function embedCommentAnnotations(
  pdfDoc: PDFDocument,
  pdfjsDoc: Awaited<ReturnType<typeof loadPdf>>,
  comments: PlacedComment[],
  renderScale: number,
  rotation: number,
): Promise<void> {
  for (const c of comments) {
    if (!c.text.trim()) continue;

    const pdfjsPage = await pdfjsDoc.getPage(c.page);
    const totalRotation = getTotalRotation(pdfjsPage, rotation);
    const viewport = pdfjsPage.getViewport({ scale: renderScale, rotation: totalRotation });

    const [x1, y1] = viewport.convertToPdfPoint(c.x, c.y);
    const [x2, y2] = viewport.convertToPdfPoint(c.x + c.width, c.y + c.height);

    const annotDict = pdfDoc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)],
      Contents: PDFString.of(c.text),
      Name: 'Comment',
      C: [1, 0.78, 0.2],
      Open: false,
    });
    const annotRef = pdfDoc.context.register(annotDict);

    const targetPage = pdfDoc.getPage(c.page - 1);
    targetPage.node.addAnnot(annotRef);
  }
}

/**
 * Applies redaction and/or a signature to a document and returns the result.
 * Nothing here touches the network — everything runs with pdf-lib (and
 * pdf.js for coordinate mapping) in the browser. Signing and redacting are
 * independent: either, both, or (if neither is given) just a pass-through
 * copy of the original bytes.
 */
export async function exportSignedPdf(params: ExportParams): Promise<Uint8Array> {
  // Parsed only for coordinate mapping — freed afterwards, since a large PDF
  // would otherwise stay in memory once per export.
  const pdfjsDoc = await loadPdf(params.pdfFile);
  try {
    return await exportWithPdfjs(params, pdfjsDoc);
  } finally {
    pdfjsDoc.destroy();
  }
}

async function exportWithPdfjs(params: ExportParams, pdfjsDoc: PdfDocument): Promise<Uint8Array> {
  const {
    pdfFile,
    documentId,
    signatureFor,
    placements = [],
    renderScale,
    rotation = 0,
    watermark,
    stripScripts = false,
    redactions = [],
    texts = [],
    comments = [],
    highlights = [],
    shapes = [],
    images = [],
    onlyPages,
    protection = {},
    formValues = {},
    pageNumbers = null,
    headerFooter = null,
    pageWatermark = null,
  } = params;

  const pdfBytes = await blobToBytes(pdfFile);
  const pdfDoc = await loadEditablePdf(pdfBytes);

  // Flatten any redacted pages — including pages with signatures — before
  // drawing signatures, so each signature ends up as a normal image on top of
  // the flattened page rather than being wiped out by it.
  await applyRedactions(pdfDoc, pdfjsDoc, redactions, renderScale, rotation);

  // The watermark goes right over the page's own content, under everything placed on it.
  if (pageWatermark) await drawPageWatermark(pdfDoc, pdfjsDoc, pageWatermark, imageFor, rotation);

  if (images.length > 0) await drawImages(pdfDoc, pdfjsDoc, images, imageFor, renderScale, rotation);
  if (shapes.length > 0) await drawShapes(pdfDoc, pdfjsDoc, shapes, renderScale, rotation);

  if (signatureFor && placements.length > 0) {
    // Each distinct signature image is watermarked and embedded once, then
    // reused by every placement that shows it.
    const embedded = new Map<Blob, Awaited<ReturnType<typeof pdfDoc.embedPng>>>();

    for (const placement of placements) {
      const signatureBlob = signatureFor(placement.signatureId);
      if (!signatureBlob) continue;
      let pngImage = embedded.get(signatureBlob);
      if (!pngImage) {
        const watermarkedBlob = await applyVisibleWatermark(signatureBlob, watermark);
        pngImage = await pdfDoc.embedPng(await blobToBytes(watermarkedBlob));
        embedded.set(signatureBlob, pngImage);
      }

      // Each `placement` is in canvas pixel coordinates for whatever page/scale/rotation
      // PDFViewer was displaying. Re-derive the exact same pdf.js viewport for that
      // page here and use its built-in point conversion — far less error-prone
      // than reimplementing the rotation trigonometry by hand, and it stays
      // correct for all four 90°-multiple rotations.
      const pdfjsPage = await pdfjsDoc.getPage(placement.page);
      const totalRotation = getTotalRotation(pdfjsPage, rotation);
      const viewport = pdfjsPage.getViewport({ scale: renderScale, rotation: totalRotation });

      // Drawn as shown: fitted in its box (object-fit: contain), upright on
      // a rotated page, and turned about the box's centre by its own angle.
      // pdf-lib turns an image counterclockwise about its bottom-left corner,
      // so that corner is found from the centre.
      const fit = Math.min(placement.width / pngImage.width, placement.height / pngImage.height);
      const width = (pngImage.width * fit) / renderScale;
      const height = (pngImage.height * fit) / renderScale;
      const [cx, cy] = viewport.convertToPdfPoint(placement.x + placement.width / 2, placement.y + placement.height / 2);
      const turn = totalRotation - (placement.angle ?? 0);
      const t = (turn * Math.PI) / 180;
      const x = cx - (width / 2) * Math.cos(t) + (height / 2) * Math.sin(t);
      const y = cy - (width / 2) * Math.sin(t) - (height / 2) * Math.cos(t);

      const targetPage = pdfDoc.getPage(placement.page - 1); // pdf-lib pages are 0-indexed
      targetPage.drawImage(pngImage, { x, y, width, height, rotate: degrees(turn) });
    }
  }

  if (texts.length > 0) {
    // One embedded font per (family, bold, italic) combination, reused across
    // every text box that shares it rather than re-embedding per box.
    const fontCache = new Map<string, Awaited<ReturnType<typeof embedTextFont>>>();

    for (const t of texts) {
      if (!t.text.trim()) continue;

      const fontKey = `${t.fontFamily}-${t.bold}-${t.italic}`;
      let font = fontCache.get(fontKey);
      if (!font) {
        font = await embedTextFont(pdfDoc, t.fontFamily, t.bold, t.italic);
        fontCache.set(fontKey, font);
      }

      const pdfjsPage = await pdfjsDoc.getPage(t.page);
      const totalRotation = getTotalRotation(pdfjsPage, rotation);
      const viewport = pdfjsPage.getViewport({ scale: renderScale, rotation: totalRotation });

      const [x1, y1] = viewport.convertToPdfPoint(t.x, t.y);
      const [x2, y2] = viewport.convertToPdfPoint(t.x + t.width, t.y + t.height);

      const x = Math.min(x1, x2);
      const topY = Math.max(y1, y2);
      const boxWidth = Math.abs(x2 - x1);
      const boxHeight = Math.abs(y2 - y1);
      // Canvas-px-to-PDF-point scale factor for this page/rotation, derived
      // from the box itself rather than a fixed constant so it stays correct
      // across zoom levels and rotations.
      const pxToPt = t.width > 0 ? boxWidth / t.width : renderScale;

      const targetPage = pdfDoc.getPage(t.page - 1);
      drawTextBox(targetPage, {
        text: t.text,
        x,
        topY,
        width: boxWidth,
        height: boxHeight,
        font,
        fontSize: t.fontSize * pxToPt,
        color: hexToRgb(t.color),
        background: t.background ? hexToRgb(t.background) : null,
        opacity: t.opacity,
        letterSpacing: t.letterSpacing * pxToPt,
        wordSpacing: t.wordSpacing * pxToPt,
        lineHeight: t.lineHeight,
        underline: t.underline,
        strikethrough: t.strikethrough,
        script: t.script,
        align: t.align,
      });
    }
  }

  if (pageNumbers || headerFooter) {
    const date = headerFooterDate();
    await drawPageLabels(
      pdfDoc,
      pdfjsDoc,
      (page, pageCount) => pageLabels(pageNumbers, headerFooter, page, pageCount, pdfFile.name, date),
      rotation,
    );
  }

  // A comment on marked-up text becomes the markup annotation's own note,
  // the way readers save one; any other comment is a sticky note.
  const marked = new Set(highlights.map((h) => `${h.page}:${h.groupId}`));
  const attached = (c: PlacedComment) => !!c.groupId && marked.has(`${c.page}:${c.groupId}`);
  const notes = new Map(
    comments.filter((c) => attached(c) && c.text.trim()).map((c) => [`${c.page}:${c.groupId}`, c.text]),
  );
  const stickyNotes = comments.filter((c) => !attached(c));

  if (stickyNotes.length > 0) {
    await embedCommentAnnotations(pdfDoc, pdfjsDoc, stickyNotes, renderScale, rotation);
  }

  if (highlights.length > 0) {
    await embedHighlightAnnotations(pdfDoc, pdfjsDoc, highlights, renderScale, rotation, notes);
  }

  fillFormFields(pdfDoc, formValues);

  // The rotation the user chose represents "this scan is sideways" and is
  // applied to every page uniformly (each relative to its own existing
  // rotation), so the whole exported document keeps a consistent orientation.
  if (rotation !== 0) {
    for (const page of pdfDoc.getPages()) {
      const current = page.getRotation().angle;
      page.setRotation(degrees(((current + rotation) % 360 + 360) % 360));
    }
  }

  if (stripScripts) stripEmbeddedScripts(pdfDoc);

  // Tag every export — signed, redacted-only, or a bare pass-through — with a
  // small local-only record the Verify page can read back later. See
  // lib/pdf/verification.ts for what this does and doesn't guarantee.
  const verificationRecord = {
    documentId,
    documentName: pdfFile.name,
    signedAt: new Date().toISOString(),
    watermarkText: watermark?.customText?.trim() || undefined,
  };
  embedVerificationRecord(pdfDoc, verificationRecord);

  // Extracting a subset of pages happens last, after every placement/redaction/
  // text/rotation has already been drawn onto the full document — copyPages
  // carries a page's finished content over as-is, so this is just a trim,
  // not a separate render pass. copyPages doesn't carry over the source
  // document's Info dict, so the record needs re-embedding on the new doc.
  if (onlyPages !== undefined) {
    const subsetDoc = await PDFDocument.create();
    const copiedPages = await subsetDoc.copyPages(
      pdfDoc,
      onlyPages.map((p) => p - 1),
    );
    copiedPages.forEach((page) => subsetDoc.addPage(page));
    embedVerificationRecord(subsetDoc, verificationRecord);
    applyProtection(subsetDoc, protection);
    return subsetDoc.save(SAVE_OPTIONS);
  }

  applyProtection(pdfDoc, protection);
  return pdfDoc.save(SAVE_OPTIONS);
}

// Field appearances are already brought up to date by fillFormFields, which
// falls back to asking the reader to redraw them if pdf-lib can't — letting
// save() retry would throw on the same unsupported characters.
const SAVE_OPTIONS = { updateFieldAppearances: false };

export function signedFileName(originalFileName: string): string {
  const base = originalFileName.replace(/\.pdf$/i, '');
  return `${base}_signed.pdf`;
}

export function pageOnlyFileName(originalFileName: string, pageNumber: number): string {
  const base = originalFileName.replace(/\.pdf$/i, '');
  return `${base}_page${pageNumber}.pdf`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();

  URL.revokeObjectURL(url);
}

export function downloadSignedPdf(bytes: Uint8Array, originalFileName: string): void {
  downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), signedFileName(originalFileName));
}

export function compressedFileName(originalFileName: string): string {
  const base = originalFileName.replace(/\.pdf$/i, '');
  return `${base}_compressed.pdf`;
}

export function downloadCompressedPdf(bytes: Uint8Array, originalFileName: string): void {
  downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), compressedFileName(originalFileName));
}

export function downloadPageOnlyPdf(bytes: Uint8Array, originalFileName: string, pageNumber: number): void {
  downloadBlob(
    new Blob([bytes as BlobPart], { type: 'application/pdf' }),
    pageOnlyFileName(originalFileName, pageNumber),
  );
}

/** e.g. "report_pages1-3_5.pdf" for pages 1, 2, 3 and 5. */
export function selectedPagesFileName(originalFileName: string, pages: number[]): string {
  const base = originalFileName.replace(/\.pdf$/i, '');
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (sorted[i + 1] === sorted[i] + 1) i++;
    ranges.push(start === sorted[i] ? `${start}` : `${start}-${sorted[i]}`);
  }
  return `${base}_pages${ranges.join('_')}.pdf`;
}

export function downloadSelectedPagesPdf(bytes: Uint8Array, originalFileName: string, pages: number[]): void {
  downloadBlob(
    new Blob([bytes as BlobPart], { type: 'application/pdf' }),
    selectedPagesFileName(originalFileName, pages),
  );
}

export function downloadZip(blob: Blob): void {
  downloadBlob(blob, `raypdf_signed_pdfs.zip`);
}

export function pagesZipFileName(originalFileName: string): string {
  const base = originalFileName.replace(/\.pdf$/i, '');
  return `${base}_pages.zip`;
}

export function downloadPagesZip(blob: Blob, originalFileName: string): void {
  downloadBlob(blob, pagesZipFileName(originalFileName));
}

export function downloadMergedPdf(bytes: Uint8Array): void {
  downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), 'raypdf_merged.pdf');
}

/**
 * Opens the browser's print dialog for a PDF without downloading or
 * navigating away — loads it into a hidden iframe (so the browser's built-in
 * PDF viewer renders it) and calls print() on that frame once it's loaded.
 */
export function printPdfBytes(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  iframe.setAttribute('aria-hidden', 'true');

  const cleanup = () => {
    iframe.remove();
    URL.revokeObjectURL(url);
  };

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      // The print dialog is modal, so removing the iframe right after
      // print() would tear down the document it's printing — wait long
      // enough for the user to actually interact with the dialog first.
      window.setTimeout(cleanup, 60_000);
    }
  };

  // Set src before inserting into the DOM — appending a src-less iframe
  // first makes it briefly navigate to about:blank, which fires its own
  // `load` event (and thus its own blank print()) before the real PDF loads.
  iframe.src = url;
  document.body.appendChild(iframe);
}

/** Whether a document has anything to export besides a signature: redactions, text, comments, form input, or page/rotation changes. */
export function hasDocumentEdits(doc: PdfDocumentState): boolean {
  return (
    doc.redactions.length > 0 ||
    doc.texts.length > 0 ||
    doc.comments.length > 0 ||
    doc.highlights.length > 0 ||
    doc.shapes.length > 0 ||
    doc.images.length > 0 ||
    Object.keys(doc.formValues).length > 0 ||
    doc.pageNumbers !== null ||
    doc.headerFooter !== null ||
    doc.pageWatermark !== null ||
    doc.file !== doc.originalFile ||
    doc.rotation !== 0
  );
}


/**
 * Splits one document into one PDF per page — each with the same
 * signature/redaction/text already applied — and bundles them into a single
 * ZIP. Complements `exportSignedPdf`'s `onlyPages`, which does the same for
 * just one page; `signatureFor`/`placements` are pre-resolved by the caller
 * exactly as for a normal single-document export.
 */
export async function exportPagesAsZip(
  doc: PdfDocumentState,
  signatureFor: SignatureLookup | undefined,
  placements: PlacedSignature[] | undefined,
  renderScale: number,
  rotation: number,
  watermark?: WatermarkOptions,
  stripScripts?: boolean,
  protection?: SaveProtection,
): Promise<Blob> {
  const zip = new JSZip();

  for (let page = 1; page <= doc.pageCount; page++) {
    const bytes = await exportSignedPdf({
      pdfFile: doc.file,
      documentId: doc.id,
      signatureFor,
      placements,
      renderScale,
      rotation,
      watermark,
      stripScripts,
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
      onlyPages: [page],
      protection,
    });
    zip.file(pageOnlyFileName(doc.file.name, page), bytes);
  }

  return zip.generateAsync({ type: 'blob' });
}

export interface BulkExportResult {
  zipBlob: Blob;
  exportedCount: number;
  /** File names of documents skipped because they had neither a placed signature nor any other edit. */
  skipped: string[];
}

/**
 * Exports every document that has a placed signature and/or another edit
 * into a single ZIP. Signatures are only drawn where the user placed them. Documents with neither are skipped and
 * reported back so the caller can tell the user.
 */
export async function exportAllAsZip(
  documents: PdfDocumentState[],
  signatureFor: SignatureLookup | null,
  renderScale: number,
  watermark?: WatermarkOptions,
  stripScripts?: boolean,
  protection?: SaveProtection,
): Promise<BulkExportResult> {
  const zip = new JSZip();
  const skipped: string[] = [];
  const usedNames = new Set<string>();

  for (const doc of documents) {
    const placements = signatureFor ? doc.placedSignatures : [];
    if (placements.length === 0 && !hasDocumentEdits(doc)) {
      skipped.push(doc.file.name);
      continue;
    }

    const bytes = await exportSignedPdf({
      pdfFile: doc.file,
      documentId: doc.id,
      signatureFor: placements.length > 0 ? (signatureFor ?? undefined) : undefined,
      placements: placements.length > 0 ? placements : undefined,
      renderScale,
      rotation: doc.rotation,
      watermark,
      stripScripts,
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
      protection,
    });

    let name = signedFileName(doc.file.name);
    if (usedNames.has(name)) {
      const base = name.replace(/\.pdf$/i, '');
      let suffix = 2;
      while (usedNames.has(`${base}_${suffix}.pdf`)) suffix++;
      name = `${base}_${suffix}.pdf`;
    }
    usedNames.add(name);

    zip.file(name, bytes);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  return { zipBlob, exportedCount: documents.length - skipped.length, skipped };
}

/**
 * Merges every given document — each with its own signature/redaction/text
 * already applied — into a single PDF, in the given order. Unlike "Save All
 * (ZIP)", a document with nothing signed/redacted/annotated is still
 * included: merging is about combining pages into one file, not skipping
 * untouched ones.
 */
export async function exportMergedPdf(
  documents: PdfDocumentState[],
  orderedIds: string[],
  signatureFor: SignatureLookup | null,
  renderScale: number,
  watermark?: WatermarkOptions,
  stripScripts?: boolean,
  protection: SaveProtection = {},
): Promise<Uint8Array> {
  const byId = new Map(documents.map((d) => [d.id, d]));
  const merged = await PDFDocument.create();

  for (const id of orderedIds) {
    const doc = byId.get(id);
    if (!doc) continue;

    const placements = signatureFor ? doc.placedSignatures : [];
    const bytes = await exportSignedPdf({
      pdfFile: doc.file,
      documentId: doc.id,
      signatureFor: placements.length > 0 ? (signatureFor ?? undefined) : undefined,
      placements: placements.length > 0 ? placements : undefined,
      renderScale,
      rotation: doc.rotation,
      watermark,
      stripScripts,
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

    const sourceDoc = await PDFDocument.load(bytes);
    const copiedPages = await merged.copyPages(sourceDoc, sourceDoc.getPageIndices());
    copiedPages.forEach((page) => merged.addPage(page));
  }

  // Applied to the merged document itself, not the per-source exports above —
  // those still need to be readable (unencrypted) for `copyPages` to read them.
  applyProtection(merged, protection);
  return merged.save();
}
