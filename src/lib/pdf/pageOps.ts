import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import { loadEditablePdf } from './password';

/**
 * Page-level edits — move, delete, duplicate, insert a blank page, rotate or
 * crop pages. Each returns a rewritten copy of the file; the editor store swaps it
 * in (keeping the old one for undo) so rendering, thumbnails, and export all
 * keep working on plain page numbers. Pages are edited within the same
 * document rather than copied into a fresh one, so everything else in the
 * file — outlines, form fields, metadata — is left as it was.
 */

/** dataTransfer type set while dragging a page thumbnail, so other drop targets can ignore it. */
export const PAGE_DRAG_TYPE = 'application/x-raypdf-page';

async function editPdf(file: File, edit: (pdfDoc: PDFDocument) => void | Promise<void>): Promise<File> {
  const pdfDoc = await loadEditablePdf(await file.arrayBuffer(), { updateMetadata: false });
  await edit(pdfDoc);
  const bytes = await pdfDoc.save();
  return new File([bytes], file.name, { type: 'application/pdf', lastModified: file.lastModified });
}

/** Moves page `from` to position `to` (both 1-indexed). */
export function movePdfPage(file: File, from: number, to: number): Promise<File> {
  return editPdf(file, (pdfDoc) => {
    const page = pdfDoc.getPage(from - 1);
    pdfDoc.removePage(from - 1);
    // removePage also deletes the page object itself — put it back so it can be re-inserted.
    pdfDoc.context.assign(page.ref, page.node);
    pdfDoc.insertPage(to - 1, page);
  });
}

/** Removes the given pages (1-indexed). At least one page must be left. */
export function deletePdfPages(file: File, pages: number[]): Promise<File> {
  return editPdf(file, (pdfDoc) => {
    const unique = [...new Set(pages)];
    if (unique.length >= pdfDoc.getPageCount()) {
      throw new Error("A PDF needs at least one page, so these can't all be deleted.");
    }
    // Highest first, so removing one doesn't shift the indexes still to go.
    for (const page of unique.sort((a, b) => b - a)) pdfDoc.removePage(page - 1);
  });
}

/** Inserts a copy of page `page` (1-indexed) right after it. */
export function duplicatePdfPage(file: File, page: number): Promise<File> {
  return editPdf(file, async (pdfDoc) => {
    // Copied from a second parse of the same bytes: copyPages expects a separate source document.
    const source = await loadEditablePdf(await file.arrayBuffer(), { updateMetadata: false });
    const [copy] = await pdfDoc.copyPages(source, [page - 1]);
    pdfDoc.insertPage(page, copy);
  });
}

/** Inserts a blank page after page `after` (1-indexed), the same size and orientation as that page. */
export function insertBlankPdfPage(file: File, after: number): Promise<File> {
  return editPdf(file, (pdfDoc) => {
    const neighbor = pdfDoc.getPage(after - 1);
    // The size shown, which for a cropped page is its crop box.
    const { width, height } = neighbor.getCropBox();
    const blank = pdfDoc.insertPage(after, [width, height]);
    blank.setRotation(neighbor.getRotation());
  });
}

/** A rectangle in a page's own PDF coordinates (points, unaffected by /Rotate). */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Crops pages (1-indexed) to the given areas by setting their crop box. What's
 * outside is hidden, not removed: it's still in the file, and can be shown
 * again with uncropPdfPages.
 */
export function cropPdfPages(file: File, crops: { page: number; area: PdfRect }[]): Promise<File> {
  return editPdf(file, (pdfDoc) => {
    for (const { page, area } of crops) {
      pdfDoc.getPage(page - 1).setCropBox(area.x, area.y, area.width, area.height);
    }
  });
}

/** Shows the whole of the given pages (1-indexed) again: the crop box becomes the media box. */
export function uncropPdfPages(file: File, pages: number[]): Promise<File> {
  return editPdf(file, (pdfDoc) => {
    for (const page of new Set(pages)) {
      const target = pdfDoc.getPage(page - 1);
      const { x, y, width, height } = target.getMediaBox();
      target.setCropBox(x, y, width, height);
    }
  });
}

/** Rotates the given pages (1-indexed) by `delta` degrees (a multiple of 90), saved into the file itself. */
export function rotatePdfPages(file: File, pages: number[], delta: number): Promise<File> {
  return editPdf(file, (pdfDoc) => {
    for (const page of new Set(pages)) {
      const target = pdfDoc.getPage(page - 1);
      const angle = (((target.getRotation().angle + delta) % 360) + 360) % 360;
      target.setRotation(degrees(angle));
    }
  });
}
