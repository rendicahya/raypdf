import type { PDFPageProxy } from 'pdfjs-dist';
import type { PdfDocument } from './loader';

/**
 * The fonts of selected text, as stored in the PDF. pdf.js's text content
 * gives each text item a font id and a transform (its size), and the font
 * object pdf.js loaded to draw the page carries the font's name from the file
 * plus bold / italic flags. The text layer has one span per text item, in the
 * same order (`textItemIndices` in lib/pdf/textLayer.ts), which is how a
 * selection maps back to its items.
 */

export interface SelectionFont {
  /** A readable family, e.g. "Times New Roman". */
  family: string;
  bold: boolean;
  italic: boolean;
  /** The names as stored in the PDF, without the subset prefix. */
  pdfNames: string[];
  /** Sizes in points, smallest first, to the nearest half point. */
  sizes: number[];
}

type TextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>;
interface PageText {
  items: { str: string; fontName: string; transform: number[] }[];
  styles: TextContent['styles'];
}

const pageTexts = new WeakMap<PdfDocument, Map<number, Promise<PageText>>>();

// The same items the text layer was built from: those with a `str`.
function pageText(doc: PdfDocument, pageNumber: number): Promise<PageText> {
  let cache = pageTexts.get(doc);
  if (!cache) {
    cache = new Map();
    pageTexts.set(doc, cache);
  }
  let text = cache.get(pageNumber);
  if (!text) {
    text = doc
      .getPage(pageNumber)
      .then((page) => page.getTextContent())
      .then((content) => ({
        items: content.items.filter((item) => 'str' in item),
        styles: content.styles,
      }));
    cache.set(pageNumber, text);
  }
  return text;
}

interface LoadedFont {
  name?: string;
  bold?: boolean;
  italic?: boolean;
}

/**
 * The font object pdf.js loaded for drawing. The page is normally drawn
 * already; if not (or pdf.js has cleaned up), loading the operator list
 * brings its fonts in. Gives up after a moment rather than waiting forever.
 */
async function loadedFont(page: PDFPageProxy, fontName: string): Promise<LoadedFont | null> {
  const objs = page.commonObjs;
  if (!objs.has(fontName)) await page.getOperatorList();
  return Promise.race([
    new Promise<LoadedFont | null>((resolve) => objs.get(fontName, (font: LoadedFont) => resolve(font ?? null))),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);
}

const STYLE_WORDS = /(Bold|Black|Heavy|Semibold|SemiBold|Demi|Italic|Oblique|Regular)+$/;

/**
 * Splits a PDF font name into a readable family and its style:
 * "ABCDEF+TimesNewRomanPS-BoldMT" is Times New Roman, bold.
 */
export function readableFontName(raw: string): { family: string; bold: boolean; italic: boolean } {
  const name = raw.replace(/^[A-Z]{6}\+/, '');
  const cut = name.search(/[-,]/);
  const trim = (s: string) => s.replace(/(PSMT|PS|MT)$/, '');
  let base = trim(cut === -1 ? name : name.slice(0, cut));
  let style = cut === -1 ? '' : name.slice(cut + 1);
  // "ArialBold": the style is run into the family.
  const runIn = cut === -1 ? base.match(STYLE_WORDS) : null;
  if (runIn && runIn.index) {
    style = runIn[0];
    base = trim(base.slice(0, runIn.index));
  }
  // Weights and widths other than bold stay with the family: "Calibri Light".
  const VARIANTS = /Thin|ExtraLight|Light|Medium|SemiBold|Semibold|Black|Condensed|Narrow/g;
  const variants = style.match(VARIANTS) ?? [];
  style = style.replace(VARIANTS, '');
  const family = [base, ...variants]
    .join(' ')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
  return {
    family,
    bold: /bold|heavy|demi/i.test(style),
    italic: /italic|oblique/i.test(style),
  };
}

const GENERIC_FAMILIES: Record<string, string> = {
  serif: 'Serif',
  'sans-serif': 'Sans-serif',
  monospace: 'Monospace',
};

/** Fonts of the given text items on a page, one entry per family and style. */
export async function selectionFonts(doc: PdfDocument, pageNumber: number, indices: number[]): Promise<SelectionFont[]> {
  const page = await doc.getPage(pageNumber);
  const { items, styles } = await pageText(doc, pageNumber);
  const byId = new Map<string, { family: string; bold: boolean; italic: boolean; pdfName: string }>();
  const fonts = new Map<string, SelectionFont>();

  for (const index of indices) {
    const item = items[index];
    if (!item || !item.str.trim()) continue;
    let described = byId.get(item.fontName);
    if (!described) {
      const font = await loadedFont(page, item.fontName);
      const pdfName = (font?.name ?? '').replace(/^[A-Z]{6}\+/, '');
      const parsed = readableFontName(pdfName);
      // Some files only have made-up names like "F1" or "T3".
      const meaningful = parsed.family.length > 2 && !/^(F|T|TT|C|R)\d+$/i.test(parsed.family);
      const generic = styles[item.fontName]?.fontFamily ?? '';
      described = {
        family: meaningful ? parsed.family : (GENERIC_FAMILIES[generic] ?? 'Unnamed font'),
        bold: parsed.bold || !!font?.bold,
        italic: parsed.italic || !!font?.italic,
        pdfName,
      };
      byId.set(item.fontName, described);
    }
    const key = `${described.family}|${described.bold}|${described.italic}`;
    let entry = fonts.get(key);
    if (!entry) {
      entry = { family: described.family, bold: described.bold, italic: described.italic, pdfNames: [], sizes: [] };
      fonts.set(key, entry);
    }
    if (described.pdfName && !entry.pdfNames.includes(described.pdfName)) entry.pdfNames.push(described.pdfName);
    const size = Math.round(Math.hypot(item.transform[2], item.transform[3]) * 2) / 2;
    if (size > 0 && !entry.sizes.includes(size)) entry.sizes.push(size);
  }

  for (const font of fonts.values()) font.sizes.sort((a, b) => a - b);
  return [...fonts.values()];
}

function sizeRange(sizes: number[]): string {
  if (sizes.length === 0) return '';
  const lo = sizes[0];
  const hi = sizes[sizes.length - 1];
  return lo === hi ? `${lo} pt` : `${lo} to ${hi} pt`;
}

/** "Times New Roman Bold, 12 pt". */
export function describeFont(font: SelectionFont): string {
  const style = [font.bold && 'Bold', font.italic && 'Italic'].filter(Boolean).join(' ');
  const size = sizeRange(font.sizes);
  return [style ? `${font.family} ${style}` : font.family, size].filter(Boolean).join(', ');
}

/** A short label for the selection toolbar, and a longer one for its tooltip. */
export function fontLabels(fonts: SelectionFont[]): { label: string; detail: string } | null {
  if (fonts.length === 0) return null;
  const detail = fonts
    .map((f) => describeFont(f) + (f.pdfNames.length ? ` (in the PDF: ${f.pdfNames.join(', ')})` : ''))
    .join('\n');
  if (fonts.length === 1) return { label: describeFont(fonts[0]), detail };
  const size = sizeRange([...new Set(fonts.flatMap((f) => f.sizes))].sort((a, b) => a - b));
  return { label: `${fonts.length} fonts${size ? `, ${size}` : ''}`, detail };
}
