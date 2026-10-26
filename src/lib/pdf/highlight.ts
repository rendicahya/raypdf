import { PDFDocument, PDFString } from '@cantoo/pdf-lib';
import { getTotalRotation, type PdfDocument } from './loader';
import type { MarkupKind, PlacedHighlight } from '../../stores/editor';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Colors offered for highlights, underlines, and strikethroughs. */
export const MARKUP_COLORS = [
  { value: '#ffe94d', label: 'Yellow' },
  { value: '#6ee7a0', label: 'Green' },
  { value: '#7cc4ff', label: 'Blue' },
  { value: '#ff8fc8', label: 'Pink' },
  { value: '#f05252', label: 'Red' },
] as const;

/** Underlines and strikethroughs are always black; only highlights take a color. */
export const LINE_MARKUP_COLOR = '#000000';

export function markupColorFor(kind: MarkupKind, color: string): string {
  return kind === 'highlight' ? color : LINE_MARKUP_COLOR;
}

export const MARKUP_LABELS: Record<MarkupKind, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'Strikethrough',
};

/** What to paint for one markup box on screen (or in a screenshot). */
export interface MarkupPaint extends Box {
  color: string;
  /** Highlights are multiplied over the page so the text stays readable; lines are drawn as-is. */
  multiply: boolean;
}

/**
 * The area to paint for one markup box, in the same canvas pixels: the whole
 * box for a highlight, a thin line for underline/strikethrough. The page's
 * on-screen rotation (0/90/180/270, page /Rotate plus the user's) decides
 * where a line goes — the bottom of upright text is the left edge once the
 * page is turned 90°, the top at 180°, the right edge at 270°.
 */
export function markupPaint(box: PlacedHighlight, totalRotation: number): MarkupPaint {
  const base = { color: markupColorFor(box.kind, box.color), multiply: box.kind === 'highlight' };
  if (box.kind === 'highlight') return { ...box, ...base };

  const turned = totalRotation % 180 !== 0;
  const thickness = turned ? box.width : box.height;
  const line = Math.max(1.5, thickness * 0.08);
  // Offset across the line of text where the stroke sits, from the text's own top edge.
  const across = box.kind === 'strikeout' ? thickness * 0.5 - line / 2 : thickness * 0.92 - line;

  switch (((totalRotation % 360) + 360) % 360) {
    case 90:
      return { ...base, x: box.x + thickness - across - line, y: box.y, width: line, height: box.height };
    case 180:
      return { ...base, x: box.x, y: box.y + thickness - across - line, width: box.width, height: line };
    case 270:
      return { ...base, x: box.x + across, y: box.y, width: line, height: box.height };
    default:
      return { ...base, x: box.x, y: box.y + across, width: box.width, height: line };
  }
}

function hexToUnitRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Turns a text selection's client rects (one per span, often overlapping)
 * into one box per line. `vertical` is for pages turned 90°/270°, where the
 * lines run top to bottom instead of left to right.
 */
export function selectionToBoxes(rects: Box[], vertical: boolean): Box[] {
  // Work in (along the line, across the line) coordinates so both
  // orientations share one merge.
  type Span = { a0: number; a1: number; c0: number; c1: number };
  const all: Span[] = rects
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .map((r) =>
      vertical
        ? { a0: r.y, a1: r.y + r.height, c0: r.x, c1: r.x + r.width }
        : { a0: r.x, a1: r.x + r.width, c0: r.y, c1: r.y + r.height },
    );
  if (all.length === 0) return [];

  // A fully selected block element (pdf.js's end-of-content marker) reports
  // its whole box — far taller than any line of text, so drop those.
  const thicknesses = all.map((s) => s.c1 - s.c0).sort((p, q) => p - q);
  const median = thicknesses[Math.floor(thicknesses.length / 2)];
  const spans = all.filter((s) => s.c1 - s.c0 <= median * 3).sort((p, q) => p.c0 - q.c0 || p.a0 - q.a0);

  const lines: Span[] = [];
  for (const s of spans) {
    const thickness = s.c1 - s.c0;
    const line = lines.find((l) => {
      const overlap = Math.min(l.c1, s.c1) - Math.max(l.c0, s.c0);
      const gap = Math.max(l.a0, s.a0) - Math.min(l.a1, s.a1);
      return overlap >= 0.5 * Math.min(thickness, l.c1 - l.c0) && gap <= thickness;
    });
    if (line) {
      line.a0 = Math.min(line.a0, s.a0);
      line.a1 = Math.max(line.a1, s.a1);
      line.c0 = Math.min(line.c0, s.c0);
      line.c1 = Math.max(line.c1, s.c1);
    } else {
      lines.push({ ...s });
    }
  }

  return lines.map((l) =>
    vertical
      ? { x: l.c0, y: l.a0, width: l.c1 - l.c0, height: l.a1 - l.a0 }
      : { x: l.a0, y: l.c0, width: l.a1 - l.a0, height: l.c1 - l.c0 },
  );
}

const num = (n: number) => n.toFixed(2);

const ANNOT_SUBTYPE: Record<MarkupKind, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'StrikeOut',
};

/**
 * Embeds each markup (all rectangles sharing a groupId) as a real PDF
 * Highlight, Underline, or StrikeOut annotation, the way Acrobat or Foxit
 * save one — readers list it with the other markups and can still remove it.
 * It carries its own appearance stream (a highlight multiplied over the
 * page, a line for the others), so it looks the same in readers that don't
 * draw markups themselves. Lines assume upright text in the page's own
 * (unrotated) coordinates, which is how nearly every PDF is laid out.
 * `notes` (by `page:groupId`) are comments on the marked text, saved as the
 * annotation's Contents, which readers show when it's hovered or opened.
 */
export async function embedHighlightAnnotations(
  pdfDoc: PDFDocument,
  pdfjsDoc: PdfDocument,
  highlights: PlacedHighlight[],
  renderScale: number,
  rotation: number,
  notes: Map<string, string> = new Map(),
): Promise<void> {
  const groups = new Map<string, PlacedHighlight[]>();
  for (const h of highlights) {
    const key = `${h.page}:${h.groupId}`;
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }

  for (const [key, group] of groups) {
    const note = notes.get(key);
    const { page, kind, color } = group[0];
    const [r, g, b] = hexToUnitRgb(markupColorFor(kind, color));
    const pdfjsPage = await pdfjsDoc.getPage(page);
    const viewport = pdfjsPage.getViewport({ scale: renderScale, rotation: getTotalRotation(pdfjsPage, rotation) });

    const boxes = group.map((h) => {
      const [x1, y1] = viewport.convertToPdfPoint(h.x, h.y);
      const [x2, y2] = viewport.convertToPdfPoint(h.x + h.width, h.y + h.height);
      return { left: Math.min(x1, x2), bottom: Math.min(y1, y2), right: Math.max(x1, x2), top: Math.max(y1, y2) };
    });

    const rect = [
      Math.min(...boxes.map((q) => q.left)),
      Math.min(...boxes.map((q) => q.bottom)),
      Math.max(...boxes.map((q) => q.right)),
      Math.max(...boxes.map((q) => q.top)),
    ];
    // Upper-left, upper-right, lower-left, lower-right — the order Acrobat writes.
    const quadPoints = boxes.flatMap((q) => [q.left, q.top, q.right, q.top, q.left, q.bottom, q.right, q.bottom]);

    // The painted area of each box: all of it for a highlight, a line near
    // the bottom for an underline, through the middle for a strikethrough.
    const painted = boxes.map((q) => {
      const height = q.top - q.bottom;
      if (kind === 'highlight') return { x: q.left, y: q.bottom, w: q.right - q.left, h: height };
      const line = Math.max(0.5, height * 0.07);
      const y = kind === 'strikeout' ? q.bottom + height * 0.5 - line / 2 : q.bottom + height * 0.08;
      return { x: q.left, y, w: q.right - q.left, h: line };
    });

    const content = [
      ...(kind === 'highlight' ? ['/GS0 gs'] : []),
      `${num(r)} ${num(g)} ${num(b)} rg`,
      ...painted.map((p) => `${num(p.x)} ${num(p.y)} ${num(p.w)} ${num(p.h)} re`),
      'f',
    ].join('\n');
    const appearance = pdfDoc.context.stream(content, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: rect,
      ...(kind === 'highlight' && {
        Resources: { ExtGState: { GS0: { Type: 'ExtGState', BM: 'Multiply' } } },
      }),
    });

    const annot = pdfDoc.context.obj({
      Type: 'Annot',
      Subtype: ANNOT_SUBTYPE[kind],
      Rect: rect,
      QuadPoints: quadPoints,
      C: [r, g, b],
      F: 4, // Print
      AP: { N: pdfDoc.context.register(appearance) },
      ...(note && { Contents: PDFString.of(note) }),
    });
    pdfDoc.getPage(page - 1).node.addAnnot(pdfDoc.context.register(annot));
  }
}
