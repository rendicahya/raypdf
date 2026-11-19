import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObjectCopier,
  PDFRef,
  StandardFonts,
  TextRenderingMode,
  beginText,
  degrees,
  endText,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  type PDFFont,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { loadEditablePdf } from './password';
import type { OcrPage } from './ocr';

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

/** `text` without the characters the font can't encode (it only covers Latin text). */
function encodableText(font: PDFFont, text: string): string {
  let result = '';
  for (const ch of text.normalize('NFKC')) {
    try {
      font.encodeText(ch);
      result += ch;
    } catch {
      // Not in the font's encoding: leave it out.
    }
  }
  return result;
}

/**
 * Writes recognized words (lib/pdf/ocr.ts) onto their pages as invisible
 * text, the way scanners' own OCR does: nothing changes on screen or in
 * print, but the words can be found, selected, and copied, here and in any
 * other PDF reader. Each word is stretched to the width it has on the page.
 */
export function addInvisibleText(file: File, pages: OcrPage[]): Promise<File> {
  return editPdf(file, (pdfDoc) => {
    const font = pdfDoc.embedStandardFont(StandardFonts.Helvetica);
    for (const { page, words } of pages) {
      if (words.length === 0) continue;
      const target = pdfDoc.getPage(page - 1);
      // The page's own content can leave its coordinate system changed;
      // wrapped in a save/restore, the text after it starts from the page's.
      target.node.normalize();
      target.node.wrapContentStreams(
        pdfDoc.context.getPushGraphicsStateContentStream(),
        pdfDoc.context.getPopGraphicsStateContentStream(),
      );
      const fontKey = target.node.newFontDictionary(font.name, font.ref);
      const operators = [beginText(), setFontAndSize(fontKey, 1), setTextRenderingMode(TextRenderingMode.Invisible)];
      for (const word of words) {
        const text = encodableText(font, word.text);
        const width = text ? font.widthOfTextAtSize(text, 1) : 0;
        if (width <= 0) continue;
        const [x, y] = word.start;
        operators.push(
          setTextMatrix(
            (word.end[0] - x) / width,
            (word.end[1] - y) / width,
            word.up[0] - x,
            word.up[1] - y,
            x,
            y,
          ),
          // The trailing space keeps words apart when the text is read back.
          showText(font.encodeText(`${text} `)),
        );
      }
      operators.push(endText());
      target.pushOperators(...operators);
    }
  });
}

/**
 * Joins several PDFs into one, in the given order, for merging tabs. The
 * first file is the base, so its outline, metadata, and form stay; the
 * others' pages are copied in after it, and their form fields join the
 * base's form. Each file's view rotation is written into its pages, so the
 * pages look the same at no extra rotation and whatever was placed on them
 * keeps its position as is. Returns the file and each part's page count.
 */
export async function mergePdfFiles(
  parts: { file: File; rotation: number }[],
  name: string,
): Promise<{ file: File; pageCounts: number[] }> {
  const [first, ...rest] = parts;
  const base = await loadEditablePdf(await first.file.arrayBuffer(), { updateMetadata: false });
  turnPages(base.getPages(), first.rotation);
  const pageCounts = [base.getPageCount()];

  for (const part of rest) {
    const source = await loadEditablePdf(await part.file.arrayBuffer(), { updateMetadata: false });
    const pages = await base.copyPages(source, source.getPageIndices());
    pages.forEach((page) => base.addPage(page));
    turnPages(pages, part.rotation);
    try {
      joinFormFields(base, source, pages);
    } catch {
      // The pages and their drawn fields are there; only filling them in may not work.
    }
    pageCounts.push(pages.length);
  }

  const bytes = await base.save();
  return { file: new File([bytes as BlobPart], name, { type: 'application/pdf' }), pageCounts };
}

function turnPages(pages: PDFPage[], delta: number) {
  if (delta % 360 === 0) return;
  for (const page of pages) page.setRotation(degrees((((page.getRotation().angle + delta) % 360) + 360) % 360));
}

/**
 * Adds the form fields of pages copied from `source` to `target`'s form, so
 * they can be filled in and saved like its own. copyPages brings the widgets
 * and their fields along but leaves them out of the form; the source form's
 * default fonts are copied too, as field appearances refer to them by name.
 */
function joinFormFields(target: PDFDocument, source: PDFDocument, pages: PDFPage[]) {
  const sourceForm = source.catalog.getAcroForm();
  if (!sourceForm) return;
  const form = target.catalog.getOrCreateAcroForm();
  const known = new Set((form.Fields()?.asArray() ?? []).map(String));

  for (const page of pages) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      const widget = target.context.lookup(ref);
      if (!(ref instanceof PDFRef) || !(widget instanceof PDFDict)) continue;
      if (widget.get(PDFName.of('Subtype')) !== PDFName.of('Widget')) continue;
      let root: PDFRef = ref;
      let dict: PDFDict = widget;
      for (let parent = dict.get(PDFName.of('Parent')); parent instanceof PDFRef; parent = dict.get(PDFName.of('Parent'))) {
        const parentDict = target.context.lookup(parent);
        if (!(parentDict instanceof PDFDict)) break;
        root = parent;
        dict = parentDict;
      }
      if (!dict.has(PDFName.of('T')) || known.has(root.toString())) continue;
      form.addField(root);
      known.add(root.toString());
    }
  }

  const sourceFonts = sourceForm.dict.lookupMaybe(PDFName.of('DR'), PDFDict)?.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!sourceFonts) return;
  let resources = form.dict.lookupMaybe(PDFName.of('DR'), PDFDict);
  if (!resources) {
    resources = target.context.obj({});
    form.dict.set(PDFName.of('DR'), resources);
  }
  let fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!fonts) {
    fonts = target.context.obj({});
    resources.set(PDFName.of('Font'), fonts);
  }
  const copier = PDFObjectCopier.for(source.context, target.context);
  for (const [key, font] of sourceFonts.entries()) {
    if (!fonts.has(key)) fonts.set(key, copier.copy(font));
  }
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
