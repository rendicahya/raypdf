import { PDFArray, PDFDict, PDFName, type PDFDocument } from '@cantoo/pdf-lib';

/**
 * Strips embedded JavaScript and auto-run actions from a PDF in place.
 *
 * RayPDF never adds any of this itself — but a source PDF (e.g. a bank or
 * government e-form built in Acrobat with field validation/auto-calc
 * scripts) can already contain it, and pdf-lib preserves the document
 * structure it doesn't touch. Some upload systems reject any PDF containing
 * active content, so this is offered as an opt-in export step rather than
 * applied unconditionally, since it can drop legitimate form behavior.
 */
export function stripEmbeddedScripts(pdfDoc: PDFDocument): void {
  const catalog = pdfDoc.catalog;
  catalog.delete(PDFName.of('OpenAction'));
  catalog.delete(PDFName.of('AA'));

  const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  names?.delete(PDFName.of('JavaScript'));

  for (const page of pdfDoc.getPages()) {
    page.node.delete(PDFName.of('AA'));

    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;

    for (let i = 0; i < annots.size(); i++) {
      const annot = pdfDoc.context.lookupMaybe(annots.get(i), PDFDict);
      annot?.delete(PDFName.of('A'));
      annot?.delete(PDFName.of('AA'));
    }
  }
}
