import * as pdfjsLib from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

// Rebuilds a page's text structure from positions, for Save as Word and
// Markdown. A PDF only says where each piece of text goes: pieces on one
// baseline make a line, and lines close together make a paragraph.

export type Piece = {
  text: string;
  x: number;
  // Baseline, from the top of the page as shown.
  y: number;
  width: number;
  size: number;
  bold: boolean;
  italic: boolean;
  /** The font's name in the file ("ABCDEF+TimesNewRomanPSMT"), or '' for form answers. */
  fontName: string;
};

export type Line = { pieces: Piece[]; y: number; size: number; left: number; right: number };

/**
 * The page's text as pieces on the page as shown (scale 1), with form field
 * answers added where they sit. Load the page's operator list first: that
 * loads the fonts, whose real names tell bold and italic.
 */
export async function readTextPieces(page: PDFPageProxy, viewport: pdfjsLib.PageViewport): Promise<Piece[]> {
  const content = await page.getTextContent();
  const pieces: Piece[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const t = pdfjsLib.Util.transform(viewport.transform, item.transform);
    // Turned text (a diagonal watermark, a label up the margin) isn't body text.
    if (Math.abs(t[1]) > Math.abs(t[0]) * 0.1 || t[0] <= 0) continue;
    const size = Math.hypot(t[2], t[3]);
    if (size < 1) continue;
    pieces.push({ text: item.str, x: t[4], y: t[5], width: item.width, size, ...fontStyle(page, item) });
  }
  pieces.push(...(await formFieldPieces(page, viewport)));
  return pieces;
}

type FieldAnnotation = {
  subtype: string;
  rect: number[];
  fieldType?: string;
  fieldValue?: string | string[];
  checkBox?: boolean;
  radioButton?: boolean;
  buttonValue?: string;
  multiLine?: boolean;
  hidden?: boolean;
  defaultAppearanceData?: { fontSize?: number };
};

// Form answers live in the fields, not the page's text, so each filled
// field becomes text where it sits: its value, or a box for a checkbox.
async function formFieldPieces(page: PDFPageProxy, viewport: pdfjsLib.PageViewport): Promise<Piece[]> {
  const pieces: Piece[] = [];
  const annotations = (await page.getAnnotations()) as FieldAnnotation[];
  for (const a of annotations) {
    if (a.subtype !== 'Widget' || a.hidden) continue;
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect);
    const box = { left: Math.min(x1, x2), top: Math.min(y1, y2), bottom: Math.max(y1, y2) };
    const height = box.bottom - box.top;
    let lines: string[] = [];
    if (a.fieldType === 'Tx' && typeof a.fieldValue === 'string') {
      lines = a.multiLine ? a.fieldValue.split(/\r\n|\r|\n/) : [a.fieldValue.replace(/\s+/g, ' ')];
    } else if (a.fieldType === 'Ch') {
      lines = [([] as string[]).concat(a.fieldValue ?? []).join(', ')];
    } else if (a.fieldType === 'Btn' && (a.checkBox || a.radioButton)) {
      const on = a.radioButton ? a.fieldValue === a.buttonValue : !!a.fieldValue && a.fieldValue !== 'Off';
      lines = [on ? '☒' : '☐'];
    }
    if (!lines.some((line) => line.trim())) continue;
    // A field's own size can be 0 (fit to the box) or oversized; answers are body text.
    const size = Math.max(6, Math.min(a.defaultAppearanceData?.fontSize || 11, 11, a.multiLine ? 11 : height * 0.7));
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const y = a.multiLine ? box.top + size * (1.2 * i + 1.1) : box.bottom - (height - size) / 2 - size * 0.2;
      pieces.push({
        text: line,
        x: box.left + 2,
        y,
        width: line.length * size * 0.5,
        size,
        bold: false,
        italic: false,
        fontName: '',
      });
    });
  }
  return pieces;
}

function fontStyle(page: PDFPageProxy, item: TextItem): Pick<Piece, 'bold' | 'italic' | 'fontName'> {
  let name = '';
  let bold = false;
  let italic = false;
  try {
    if (page.commonObjs.has(item.fontName)) {
      const font = page.commonObjs.get(item.fontName) as { name?: string; bold?: boolean; black?: boolean; italic?: boolean };
      name = font.name ?? '';
      bold = !!(font.bold || font.black);
      italic = !!font.italic;
    }
  } catch {
    // An unloaded font only loses the styling.
  }
  return {
    bold: bold || /bold|black|heavy|semibold|demi/i.test(name),
    italic: italic || /italic|oblique/i.test(name),
    fontName: name,
  };
}

/** The text size most of the document is set in, weighted by characters. */
export function mostCommonSize(pieces: Piece[]): number {
  const counts = new Map<number, number>();
  for (const piece of pieces) {
    const size = Math.round(piece.size * 2) / 2;
    counts.set(size, (counts.get(size) ?? 0) + piece.text.length);
  }
  let best = 11;
  let bestCount = 0;
  for (const [size, count] of counts) {
    if (count > bestCount) [best, bestCount] = [size, count];
  }
  return best;
}

export function groupLines(pieces: Piece[]): Line[] {
  const sorted = [...pieces].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Line[] = [];
  for (const piece of sorted) {
    const line = lines.at(-1);
    if (line && Math.abs(piece.y - line.y) < Math.max(piece.size, line.size) * 0.4) {
      line.pieces.push(piece);
      line.size = Math.max(line.size, piece.size);
    } else {
      lines.push({ pieces: [piece], y: piece.y, size: piece.size, left: 0, right: 0 });
    }
  }
  for (const line of lines) {
    line.pieces.sort((a, b) => a.x - b.x);
    line.left = line.pieces[0].x;
    line.right = Math.max(...line.pieces.map((p) => p.x + p.width));
  }
  return lines;
}

export const LIST_MARKER = /^\s*([•◦▪▫■□●○‣⁃∙·\-–—*]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|\(?[ivxIVX]{1,4}[.)])\s/;

export function groupParagraphs(lines: Line[], contentLeft: number, contentRight: number): Line[][] {
  const paragraphs: Line[][] = [];
  const fullWidth = contentRight - contentLeft;
  let previous: Line | null = null;
  for (const line of lines) {
    const current = paragraphs.at(-1);
    const continues =
      previous !== null &&
      current !== undefined &&
      line.y - previous.y > 0 &&
      line.y - previous.y < Math.max(line.size, previous.size) * 1.75 &&
      Math.abs(line.size - previous.size) < previous.size * 0.15 &&
      allBold(line) === allBold(previous) &&
      // Rows split into columns (labels, a form's answers) stay one per line.
      !hasColumns(line) &&
      !hasColumns(previous) &&
      // A short line ends its paragraph (or it's an address, a list, a title).
      previous.right > contentRight - fullWidth * 0.25 &&
      // A line further in than the one above starts a new paragraph.
      line.left < previous.left + line.size &&
      !LIST_MARKER.test(lineText(line));
    if (continues) current.push(line);
    else paragraphs.push([line]);
    previous = line;
  }
  return paragraphs;
}

export function allBold(line: Line): boolean {
  return line.pieces.every((p) => p.bold);
}

/** A wide gap between two pieces on one line: a column or a tab stop. */
export function isColumnGap(previous: Piece, piece: Piece): boolean {
  return piece.x - (previous.x + previous.width) > piece.size * 3;
}

export function hasColumns(line: Line): boolean {
  return line.pieces.some((p, i) => i > 0 && isColumnGap(line.pieces[i - 1], p));
}

export function lineText(line: Line): string {
  return line.pieces.map((p) => p.text).join(' ');
}
