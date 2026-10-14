import { PDFDocument } from '@cantoo/pdf-lib';

/** dataTransfer type set while dragging a page thumbnail, so other drop targets can ignore it. */
export const PAGE_DRAG_TYPE = 'application/x-signy-page';

/**
 * Returns a copy of `file` with page `from` moved to position `to` (both
 * 1-indexed).
 *
 * The page is detached and re-inserted within the same document (rather than
 * copied into a fresh one) so everything else in the file — outlines, form
 * fields, metadata — is left as it was.
 */
export async function movePdfPage(file: File, from: number, to: number): Promise<File> {
  const pdfDoc = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  const page = pdfDoc.getPage(from - 1);
  pdfDoc.removePage(from - 1);
  // removePage also deletes the page object itself — put it back so it can be re-inserted.
  pdfDoc.context.assign(page.ref, page.node);
  pdfDoc.insertPage(to - 1, page);

  const bytes = await pdfDoc.save();
  return new File([bytes], file.name, { type: 'application/pdf', lastModified: file.lastModified });
}
