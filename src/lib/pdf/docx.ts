import * as pdfjsLib from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageOrientation,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
} from 'docx';
import { downloadBlob } from './screenshot';
import './loader'; // sets up the pdf.js worker

// Converts an exported PDF into an editable Word document, in the browser.
// A PDF only says where each piece of text and each picture goes, so the
// structure is rebuilt from positions: pieces on one baseline make a line,
// lines close together make a paragraph, bigger text makes a heading, and
// pictures are cut from the rendered page and placed where they sat. Each
// PDF page becomes a section of the same size, so page breaks match. Good
// for letters, reports, and contracts; tables and columns come out as text.

// Pictures are cut from the page rendered at this scale (144 dpi).
const IMAGE_SCALE = 2;
// Pictures smaller than this (in points) are decoration, not content.
const MIN_IMAGE_SIZE = 8;
const POINTS_TO_PIXELS = 96 / 72;
const POINTS_TO_TWIPS = 20;

type Piece = {
  text: string;
  x: number;
  // Baseline, from the top of the page as shown.
  y: number;
  width: number;
  size: number;
  bold: boolean;
  italic: boolean;
  font: string | undefined;
};

type Line = { pieces: Piece[]; y: number; size: number; left: number; right: number };

type Rect = { x: number; y: number; width: number; height: number };

type Block =
  | { kind: 'text'; top: number; bottom: number; lines: Line[] }
  | { kind: 'image'; top: number; bottom: number; rect: Rect };

/** Converts the PDF's pages to a .docx and downloads it as original_filename.docx. */
export async function downloadPdfAsDocx(bytes: Uint8Array, originalFileName: string): Promise<void> {
  const blob = await convertPdfToDocx(bytes);
  downloadBlob(blob, `${originalFileName.replace(/\.pdf$/i, '')}.docx`);
}

export async function convertPdfToDocx(bytes: Uint8Array): Promise<Blob> {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  try {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) pages.push(await readPage(await pdf.getPage(n)));

    const bodySize = mostCommonSize(pages.flatMap((page) => page.pieces));
    const sections = await Promise.all(pages.map((page) => buildSection(page, bodySize)));

    return Packer.toBlob(
      new Document({
        styles: {
          default: {
            document: { run: { font: 'Calibri', size: Math.round(bodySize * 2) } },
            // Word's heading styles are blue; the PDF's text keeps its own look.
            heading1: { run: { color: '000000' } },
            heading2: { run: { color: '000000' } },
            heading3: { run: { color: '000000', italics: false } },
          },
        },
        sections,
      }),
    );
  } finally {
    await pdf.destroy();
  }
}

type PageContent = {
  page: PDFPageProxy;
  width: number;
  height: number;
  pieces: Piece[];
  images: Rect[];
};

async function readPage(page: PDFPageProxy): Promise<PageContent> {
  const viewport = page.getViewport({ scale: 1 });
  // The operator list also loads the fonts, whose real names tell bold and italic.
  const operators = await page.getOperatorList();
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

  return { page, width: viewport.width, height: viewport.height, pieces, images: imageRects(operators, viewport) };
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
        font: undefined,
      });
    });
  }
  return pieces;
}

function fontStyle(page: PDFPageProxy, item: TextItem): Pick<Piece, 'bold' | 'italic' | 'font'> {
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
    font: wordFont(name),
  };
}

// Embedded font names ("ABCDEF+TimesNewRomanPSMT") mapped to fonts Word has.
const WORD_FONTS: [RegExp, string][] = [
  [/times/i, 'Times New Roman'],
  [/arial|helvetica/i, 'Arial'],
  [/courier/i, 'Courier New'],
  [/calibri/i, 'Calibri'],
  [/cambria/i, 'Cambria'],
  [/georgia/i, 'Georgia'],
  [/verdana/i, 'Verdana'],
  [/tahoma/i, 'Tahoma'],
  [/garamond/i, 'Garamond'],
  [/segoe/i, 'Segoe UI'],
  [/trebuchet/i, 'Trebuchet MS'],
  [/bookman/i, 'Bookman Old Style'],
  [/palatino/i, 'Palatino Linotype'],
  [/century/i, 'Century'],
];

function wordFont(name: string): string | undefined {
  const base = name.replace(/^[A-Z]{6}\+/, '');
  return WORD_FONTS.find(([pattern]) => pattern.test(base))?.[1];
}

// Where each picture is painted, as boxes on the page as shown: the current
// transform is followed through the operator list, and a picture fills the
// unit square under it.
function imageRects(
  operators: { fnArray: number[]; argsArray: unknown[] },
  viewport: { transform: number[]; width: number; height: number },
): Rect[] {
  const { OPS, Util } = pdfjsLib;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const rects: Rect[] = [];

  operators.fnArray.forEach((fn, i) => {
    const args = operators.argsArray[i] as unknown[] | null;
    switch (fn) {
      case OPS.save:
        stack.push(ctm);
        break;
      case OPS.restore:
        ctm = stack.pop() ?? ctm;
        break;
      case OPS.transform:
        ctm = Util.transform(ctm, args as number[]);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push(ctm);
        if (Array.isArray(args?.[0])) ctm = Util.transform(ctm, args[0] as number[]);
        break;
      case OPS.paintFormXObjectEnd:
        ctm = stack.pop() ?? ctm;
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject: {
        const m = Util.transform(viewport.transform, ctm);
        const corners = [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ].map(([x, y]) => Util.applyTransform([x, y], m));
        const xs = corners.map((c) => c[0]);
        const ys = corners.map((c) => c[1]);
        const left = Math.max(0, Math.min(...xs));
        const top = Math.max(0, Math.min(...ys));
        const right = Math.min(viewport.width, Math.max(...xs));
        const bottom = Math.min(viewport.height, Math.max(...ys));
        if (right - left >= MIN_IMAGE_SIZE && bottom - top >= MIN_IMAGE_SIZE) {
          rects.push({ x: left, y: top, width: right - left, height: bottom - top });
        }
        break;
      }
    }
  });

  // A picture inside another (a stamp on a photo) comes along with it.
  return rects.filter(
    (r, i) =>
      !rects.some(
        (o, j) =>
          j !== i &&
          contains(o, r) &&
          // Of two identical boxes, keep the first.
          (!contains(r, o) || j < i),
      ),
  );
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1
  );
}

/** The text size most of the document is set in, weighted by characters. */
function mostCommonSize(pieces: Piece[]): number {
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

function groupLines(pieces: Piece[]): Line[] {
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

const LIST_MARKER = /^\s*([•◦▪▫■□●○‣⁃∙·\-–—*]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|\(?[ivxIVX]{1,4}[.)])\s/;

function groupParagraphs(lines: Line[], contentLeft: number, contentRight: number): Line[][] {
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

function allBold(line: Line): boolean {
  return line.pieces.every((p) => p.bold);
}

// Matches where paragraphRuns puts a tab.
function hasColumns(line: Line): boolean {
  return line.pieces.some((p, i) => i > 0 && p.x - (line.pieces[i - 1].x + line.pieces[i - 1].width) > p.size * 3);
}

function lineText(line: Line): string {
  return line.pieces.map((p) => p.text).join(' ');
}

async function buildSection(content: PageContent, bodySize: number) {
  const { pieces, width, height } = content;
  const lines = groupLines(pieces);

  // A picture over most of a page with text is a scan with recognized text
  // under it, or a background: the text is what's wanted.
  const pageArea = width * height;
  const images = content.images.filter((r) => lines.length === 0 || r.width * r.height < pageArea * 0.85);

  const lefts = [...lines.map((l) => l.left), ...images.map((r) => r.x)];
  const rights = [...lines.map((l) => l.right), ...images.map((r) => r.x + r.width)];
  const tops = [...lines.map((l) => l.y - l.size), ...images.map((r) => r.y)];
  const bottoms = [...lines.map((l) => l.y + l.size * 0.3), ...images.map((r) => r.y + r.height)];
  const margin = (value: number) => Math.min(144, Math.max(18, value));
  // Short lines or a half-empty page don't mean wide margins, so the right
  // and bottom margins are at most the left and top ones (or an inch).
  const left = lefts.length ? margin(Math.min(...lefts)) : 72;
  const top = tops.length ? margin(Math.min(...tops)) : 72;
  const margins = {
    left,
    top,
    right: rights.length ? margin(Math.min(width - Math.max(...rights), Math.max(left, 72))) : 72,
    bottom: bottoms.length ? margin(Math.min(height - Math.max(...bottoms), Math.max(top, 72))) : 72,
  };
  const contentLeft = margins.left;
  const contentRight = width - margins.right;
  const contentWidth = contentRight - contentLeft;
  const contentHeight = height - margins.top - margins.bottom;

  const blocks: Block[] = [
    ...groupParagraphs(lines, contentLeft, contentRight).map(
      (paragraphLines): Block => ({
        kind: 'text',
        top: paragraphLines[0].y - paragraphLines[0].size,
        bottom: paragraphLines.at(-1)!.y,
        lines: paragraphLines,
      }),
    ),
    ...images.map((rect): Block => ({ kind: 'image', top: rect.y, bottom: rect.y + rect.height, rect })),
  ].sort((a, b) => a.top - b.top);

  const canvas = images.length > 0 ? await renderPage(content.page) : null;

  const children: Paragraph[] = [];
  for (const [i, block] of blocks.entries()) {
    // The space down to the next block, less a line, becomes space after.
    const next = blocks[i + 1];
    const lineHeight = block.kind === 'text' ? block.lines.at(-1)!.size * 1.2 : 0;
    const gap = next ? next.top - block.bottom - (block.kind === 'text' ? lineHeight - block.lines.at(-1)!.size : 0) : 0;
    const after = Math.round(Math.min(36, Math.max(0, gap)) * POINTS_TO_TWIPS);

    if (block.kind === 'text') {
      children.push(textParagraph(block.lines, bodySize, contentLeft, contentRight, after));
    } else if (canvas) {
      const { rect } = block;
      const fit = Math.min(1, contentWidth / rect.width, contentHeight / rect.height);
      const centred = Math.abs(rect.x + rect.width / 2 - (contentLeft + contentRight) / 2) < contentWidth * 0.05;
      const indent = Math.max(0, Math.min(rect.x - contentLeft, contentWidth - rect.width * fit));
      const photo = rect.width * rect.height > 200 * 200;
      children.push(
        new Paragraph({
          alignment: centred ? AlignmentType.CENTER : AlignmentType.LEFT,
          indent: centred ? undefined : { left: Math.round(indent * POINTS_TO_TWIPS) },
          spacing: { before: 0, after },
          children: [
            new ImageRun({
              type: photo ? 'jpg' : 'png',
              data: await cropImage(canvas, rect, photo),
              transformation: {
                width: Math.round(rect.width * fit * POINTS_TO_PIXELS),
                height: Math.round(rect.height * fit * POINTS_TO_PIXELS),
              },
            }),
          ],
        }),
      );
    }
  }

  // The library takes portrait sizes and swaps them for landscape.
  const landscape = width > height;
  return {
    properties: {
      page: {
        size: {
          width: Math.round(Math.min(width, height) * POINTS_TO_TWIPS),
          height: Math.round(Math.max(width, height) * POINTS_TO_TWIPS),
          orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
        },
        margin: {
          top: Math.round(margins.top * POINTS_TO_TWIPS),
          right: Math.round(margins.right * POINTS_TO_TWIPS),
          bottom: Math.round(margins.bottom * POINTS_TO_TWIPS),
          left: Math.round(margins.left * POINTS_TO_TWIPS),
          header: 0,
          footer: 0,
        },
      },
    },
    children: children.length > 0 ? children : [new Paragraph({})],
  };
}

function textParagraph(lines: Line[], bodySize: number, contentLeft: number, contentRight: number, after: number) {
  const first = lines[0];
  const contentWidth = contentRight - contentLeft;
  const contentCentre = (contentLeft + contentRight) / 2;

  const size = first.size;
  const heading =
    size >= bodySize * 1.6
      ? HeadingLevel.HEADING_1
      : size >= bodySize * 1.3
        ? HeadingLevel.HEADING_2
        : size >= bodySize * 1.12 && allBold(first)
          ? HeadingLevel.HEADING_3
          : undefined;

  const near = (a: number, b: number) => Math.abs(a - b) < Math.max(size * 1.5, contentWidth * 0.02);
  const centred = lines.every(
    (l) => near((l.left + l.right) / 2, contentCentre) && l.left > contentLeft + size * 2,
  );
  const rightAligned =
    !centred && lines.every((l) => near(l.right, contentRight) && l.left > contentLeft + contentWidth * 0.3);
  const justified =
    !centred && lines.length > 2 && lines.slice(0, -1).every((l) => near(l.right, contentRight));
  const alignment = centred
    ? AlignmentType.CENTER
    : rightAligned
      ? AlignmentType.RIGHT
      : justified
        ? AlignmentType.JUSTIFIED
        : AlignmentType.LEFT;

  // Indents only matter for left-aligned and justified text.
  let indent: { left?: number; firstLine?: number; hanging?: number } | undefined;
  if (!centred && !rightAligned) {
    const rest = lines.length > 1 ? Math.min(...lines.slice(1).map((l) => l.left)) : first.left;
    const left = Math.max(0, rest - contentLeft);
    const firstLine = first.left - contentLeft - left;
    indent = {
      left: Math.round(left * POINTS_TO_TWIPS),
      ...(firstLine > 2
        ? { firstLine: Math.round(firstLine * POINTS_TO_TWIPS) }
        : firstLine < -2
          ? { hanging: Math.round(-firstLine * POINTS_TO_TWIPS) }
          : {}),
    };
  }

  const { runs, tabs } = paragraphRuns(lines);
  // Tab stops are measured from the left margin.
  const tabStops = [...new Set(tabs.map((x) => Math.round((x - contentLeft) * POINTS_TO_TWIPS)))]
    .filter((position) => position > 0)
    .sort((a, b) => a - b)
    .map((position) => ({ type: TabStopType.LEFT, position }));

  return new Paragraph({
    heading,
    alignment,
    indent,
    tabStops: tabStops.length > 0 ? tabStops : undefined,
    spacing: { before: 0, after },
    children: runs,
  });
}

type RunStyle = Pick<Piece, 'bold' | 'italic' | 'font'> & { size: number };

/** The paragraph's text runs, and where its tabs jump to (x on the page). */
function paragraphRuns(lines: Line[]): { runs: TextRun[]; tabs: number[] } {
  const runs: { style: RunStyle; parts: (string | Tab)[] }[] = [];
  const tabs: number[] = [];
  const add = (style: RunStyle, part: string | Tab) => {
    const last = runs.at(-1);
    const same =
      last &&
      last.style.bold === style.bold &&
      last.style.italic === style.italic &&
      last.style.font === style.font &&
      last.style.size === style.size;
    if (same) last.parts.push(part);
    else runs.push({ style, parts: [part] });
  };
  const lastText = () => {
    const parts = runs.at(-1)?.parts;
    const part = parts?.at(-1);
    return typeof part === 'string' ? part : '';
  };

  lines.forEach((line, lineIndex) => {
    line.pieces.forEach((piece, pieceIndex) => {
      const style: RunStyle = {
        bold: piece.bold,
        italic: piece.italic,
        font: piece.font,
        size: Math.round(piece.size * 2),
      };
      let text = piece.text;
      if (pieceIndex === 0 && lineIndex > 0) {
        // A word broken across lines with a hyphen is joined again.
        const before = lastText();
        if (/\p{L}-$/u.test(before) && /^\p{Ll}/u.test(text)) {
          const last = runs.at(-1)!;
          last.parts[last.parts.length - 1] = before.slice(0, -1);
        } else if (!/\s$/.test(before) && !/^\s/.test(text)) {
          text = ' ' + text;
        }
      } else if (pieceIndex > 0) {
        const previous = line.pieces[pieceIndex - 1];
        const gap = piece.x - (previous.x + previous.width);
        // A wide gap on one line is a column or a tab stop.
        if (gap > piece.size * 3) {
          add(style, new Tab());
          tabs.push(piece.x);
        } else if (gap > piece.size * 0.15 && !/\s$/.test(previous.text) && !/^\s/.test(text)) text = ' ' + text;
      }
      add(style, text);
    });
  });

  return {
    runs: runs.map(
      ({ style, parts }) =>
        new TextRun({
          children: mergeStrings(parts),
          bold: style.bold || undefined,
          italics: style.italic || undefined,
          font: style.font,
          size: style.size,
        }),
    ),
    tabs,
  };
}

function mergeStrings(parts: (string | Tab)[]): (string | Tab)[] {
  const merged: (string | Tab)[] = [];
  for (const part of parts) {
    const last = merged.at(-1);
    if (typeof part === 'string' && typeof last === 'string') merged[merged.length - 1] = last + part;
    else merged.push(part);
  }
  return merged;
}

async function renderPage(page: PDFPageProxy): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: IMAGE_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const canvasContext = canvas.getContext('2d');
  if (!canvasContext) throw new Error('Canvas 2D context unavailable');
  canvasContext.fillStyle = '#fff';
  canvasContext.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext, viewport, annotationMode: pdfjsLib.AnnotationMode.ENABLE }).promise;
  return canvas;
}

async function cropImage(canvas: HTMLCanvasElement, rect: Rect, photo: boolean): Promise<Uint8Array> {
  const crop = document.createElement('canvas');
  crop.width = Math.max(1, Math.round(rect.width * IMAGE_SCALE));
  crop.height = Math.max(1, Math.round(rect.height * IMAGE_SCALE));
  const context = crop.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable');
  context.drawImage(
    canvas,
    rect.x * IMAGE_SCALE,
    rect.y * IMAGE_SCALE,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  );
  const blob = await new Promise<Blob>((resolve, reject) =>
    crop.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to create the image'))),
      photo ? 'image/jpeg' : 'image/png',
      0.9,
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
