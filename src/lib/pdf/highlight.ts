import { PDFDocument } from '@cantoo/pdf-lib';
import { getTotalRotation, type PdfDocument } from './loader';
import type { PlacedHighlight } from '../../stores/editor';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** CSS color of a highlight on screen; HIGHLIGHT_RGB is the same color for the PDF. */
export const HIGHLIGHT_COLOR = '#ffe94d';
export const HIGHLIGHT_RGB: [number, number, number] = [1, 0.914, 0.302];

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

/**
 * Embeds each highlight (all rectangles sharing a groupId) as a real PDF
 * Highlight annotation, the way Acrobat or Foxit save one — readers list it
 * with the other markups and can still remove it. It carries its own
 * appearance stream, multiplied over the page, so it looks the same in
 * readers that don't draw highlights themselves.
 */
export async function embedHighlightAnnotations(
  pdfDoc: PDFDocument,
  pdfjsDoc: PdfDocument,
  highlights: PlacedHighlight[],
  renderScale: number,
  rotation: number,
): Promise<void> {
  const groups = new Map<string, PlacedHighlight[]>();
  for (const h of highlights) {
    const key = `${h.page}:${h.groupId}`;
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }

  const [r, g, b] = HIGHLIGHT_RGB;
  for (const group of groups.values()) {
    const page = group[0].page;
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

    const content = [
      '/GS0 gs',
      `${num(r)} ${num(g)} ${num(b)} rg`,
      ...boxes.map((q) => `${num(q.left)} ${num(q.bottom)} ${num(q.right - q.left)} ${num(q.top - q.bottom)} re`),
      'f',
    ].join('\n');
    const appearance = pdfDoc.context.stream(content, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: rect,
      Resources: { ExtGState: { GS0: { Type: 'ExtGState', BM: 'Multiply' } } },
    });

    const annot = pdfDoc.context.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: rect,
      QuadPoints: quadPoints,
      C: [r, g, b],
      F: 4, // Print
      AP: { N: pdfDoc.context.register(appearance) },
    });
    pdfDoc.getPage(page - 1).node.addAnnot(pdfDoc.context.register(annot));
  }
}
