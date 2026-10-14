import { PDFDocument, degrees } from '@cantoo/pdf-lib';

/**
 * Page-level edits — move, delete, duplicate, insert a blank page, rotate one
 * page. Each returns a rewritten copy of the file; the editor store swaps it
 * in (keeping the old one for undo) so rendering, thumbnails, and export all
 * keep working on plain page numbers. Pages are edited within the same
 * document rather than copied into a fresh one, so everything else in the
 * file — outlines, form fields, metadata — is left as it was.
 */

/** dataTransfer type set while dragging a page thumbnail, so other drop targets can ignore it. */
export const PAGE_DRAG_TYPE = 'application/x-signy-page';

async function editPdf(file: File, edit: (pdfDoc: PDFDocument) => void | Promise<void>): Promise<File> {
  const pdfDoc = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
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

/** Removes page `page` (1-indexed). The caller must keep at least one page. */
export function deletePdfPage(file: File, page: number): Promise<File> {
  return editPdf(file, (pdfDoc) => {
    if (pdfDoc.getPageCount() <= 1) throw new Error("A PDF needs at least one page — this one can't be deleted.");
    pdfDoc.removePage(page - 1);
  });
}

/** Inserts a copy of page `page` (1-indexed) right after it. */
export function duplicatePdfPage(file: File, page: number): Promise<File> {
  return editPdf(file, async (pdfDoc) => {
    // Copied from a second parse of the same bytes: copyPages expects a separate source document.
    const source = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
    const [copy] = await pdfDoc.copyPages(source, [page - 1]);
    pdfDoc.insertPage(page, copy);
  });
}

/** Inserts a blank page after page `after` (1-indexed), the same size and orientation as that page. */
export function insertBlankPdfPage(file: File, after: number): Promise<File> {
  return editPdf(file, (pdfDoc) => {
    const neighbor = pdfDoc.getPage(after - 1);
    const { width, height } = neighbor.getSize();
    const blank = pdfDoc.insertPage(after, [width, height]);
    blank.setRotation(neighbor.getRotation());
  });
}

/** Rotates page `page` (1-indexed) by `delta` degrees (a multiple of 90), saved into the file itself. */
export function rotatePdfPage(file: File, page: number, delta: number): Promise<File> {
  return editPdf(file, (pdfDoc) => {
    const target = pdfDoc.getPage(page - 1);
    const angle = (((target.getRotation().angle + delta) % 360) + 360) % 360;
    target.setRotation(degrees(angle));
  });
}
