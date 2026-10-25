import { degrees, type PDFDocument } from '@cantoo/pdf-lib';
import { getTotalRotation, type PdfDocument } from './loader';
import { embedTextFont, hexToRgb } from './textRender';

export type PageNumberPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type PageNumberFormat = 'number' | 'page' | 'pageOf' | 'slash' | 'dashes';

export type PageNumberFont = 'helvetica' | 'times' | 'courier';

/** How a document's pages are numbered. Sizes are in PDF points, so they don't change with zoom. */
export interface PageNumberSettings {
  position: PageNumberPosition;
  format: PageNumberFormat;
  /** The number the first numbered page gets. */
  startAt: number;
  /** First page (1-indexed) that gets a number; the ones before it (a cover, say) are left alone. */
  fromPage: number;
  font: PageNumberFont;
  fontSize: number;
  /** Distance from the page edges. */
  margin: number;
  /** CSS hex color. */
  color: string;
}

export const DEFAULT_PAGE_NUMBERS: PageNumberSettings = {
  position: 'bottom-center',
  format: 'number',
  startAt: 1,
  fromPage: 1,
  font: 'helvetica',
  fontSize: 11,
  margin: 28,
  color: '#000000',
};

export const PAGE_NUMBER_FORMATS: { value: PageNumberFormat; label: string }[] = [
  { value: 'number', label: '1' },
  { value: 'page', label: 'Page 1' },
  { value: 'pageOf', label: 'Page 1 of 9' },
  { value: 'slash', label: '1 / 9' },
  { value: 'dashes', label: '- 1 -' },
];

/** The text shown on `page` (1-indexed) of a `pageCount`-page document, or null if it isn't numbered. */
export function pageNumberLabel(settings: PageNumberSettings, page: number, pageCount: number): string | null {
  if (page < settings.fromPage) return null;
  const n = settings.startAt + page - settings.fromPage;
  const total = settings.startAt + pageCount - settings.fromPage;
  switch (settings.format) {
    case 'page':
      return `Page ${n}`;
    case 'pageOf':
      return `Page ${n} of ${total}`;
    case 'slash':
      return `${n} / ${total}`;
    case 'dashes':
      return `- ${n} -`;
    default:
      return `${n}`;
  }
}

/** Roughly the height of a digit, as a share of the font size, so a top number sits `margin` below the edge. */
const CAP_HEIGHT = 0.72;

/**
 * Where the label's baseline starts on a page of `width` × `height` as shown
 * (y downwards), in the same units as `textWidth`. `unit` converts the
 * settings' points into those units.
 */
export function pageNumberAnchor(
  settings: PageNumberSettings,
  width: number,
  height: number,
  textWidth: number,
  unit: number,
): { x: number; baseline: number } {
  const margin = settings.margin * unit;
  const [vertical, horizontal] = settings.position.split('-');
  const x =
    horizontal === 'left' ? margin : horizontal === 'right' ? width - margin - textWidth : (width - textWidth) / 2;
  const baseline = vertical === 'top' ? margin + settings.fontSize * unit * CAP_HEIGHT : height - margin;
  return { x, baseline };
}

/**
 * Draws the numbers onto the pages, upright and placed as the page is shown:
 * the position is worked out on the rotated page and mapped back to PDF
 * space, and the text is turned to match.
 */
export async function drawPageNumbers(
  pdfDoc: PDFDocument,
  pdfjsDoc: PdfDocument,
  settings: PageNumberSettings,
  rotation: number,
): Promise<void> {
  const font = await embedTextFont(pdfDoc, settings.font, false, false);
  const color = hexToRgb(settings.color);
  const pages = pdfDoc.getPages();

  for (let i = 0; i < pages.length; i++) {
    const label = pageNumberLabel(settings, i + 1, pages.length);
    if (!label) continue;
    const pdfjsPage = await pdfjsDoc.getPage(i + 1);
    const totalRotation = getTotalRotation(pdfjsPage, rotation);
    const viewport = pdfjsPage.getViewport({ scale: 1, rotation: totalRotation });
    const textWidth = font.widthOfTextAtSize(label, settings.fontSize);
    const { x, baseline } = pageNumberAnchor(settings, viewport.width, viewport.height, textWidth, 1);
    const [px, py] = viewport.convertToPdfPoint(x, baseline);
    pages[i].drawText(label, {
      x: px,
      y: py,
      size: settings.fontSize,
      font,
      color,
      rotate: degrees(totalRotation),
    });
  }
}
