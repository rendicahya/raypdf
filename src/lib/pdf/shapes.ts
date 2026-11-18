import { degrees, LineCapStyle, type PDFDocument, type PDFImage, type PDFPage } from '@cantoo/pdf-lib';
import { getTotalRotation, type PdfDocument } from './loader';
import type { EditableItemRecorder } from './editableItems';
import { hexToRgb } from './textRender';
import type { PlacedImage, PlacedShape } from '../../stores/editor';
import type { StoredImage } from '../../stores/images';

type Point = [number, number];

/**
 * Where a line or arrow is drawn, in the same units as the shape's box:
 * corner to corner, with the arrowhead at the end. `strokes` are segments
 * drawn with the line's width and round caps; `fills` are outlines filled in
 * the line's color, all in one path (nonzero, so where they overlap is filled
 * once and a see-through arrow shows no darker seam). A filled head makes the
 * whole arrow filled: the shaft becomes an outline with a round start. Shared
 * by the editor (SVG), screenshots (canvas), and export (PDF), so all three
 * match.
 */
export function lineGeometry(
  s: Pick<PlacedShape, 'x' | 'y' | 'width' | 'height' | 'flipX' | 'flipY' | 'kind' | 'strokeWidth' | 'arrowHead'>,
): { start: Point; end: Point; strokes: Point[][]; fills: Point[][] } {
  const start: Point = [s.flipX ? s.x + s.width : s.x, s.flipY ? s.y + s.height : s.y];
  const end: Point = [s.flipX ? s.x : s.x + s.width, s.flipY ? s.y : s.y + s.height];
  if (s.kind !== 'arrow') return { start, end, strokes: [[start, end]], fills: [] };

  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const span = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const spread = (28 * Math.PI) / 180;
  const head = s.arrowHead ?? 'open';

  if (head === 'open') {
    const length = Math.max(10, s.strokeWidth * 4);
    const wing = (a: number): Point => [end[0] - length * Math.cos(angle + a), end[1] - length * Math.sin(angle + a)];
    return { start, end, strokes: [[start, end], [wing(spread), end], [wing(-spread), end]], fills: [] };
  }

  // Along the arrow (u) and across it (n).
  const u: Point = span > 0 ? [dx / span, dy / span] : [1, 0];
  const n: Point = [-u[1], u[0]];
  const at = (from: Point, along: number, across = 0): Point => [
    from[0] + u[0] * along + n[0] * across,
    from[1] + u[1] * along + n[1] * across,
  ];
  // A filled head is a little longer than an open one, but never longer than the arrow.
  const length = Math.min(Math.max(12, s.strokeWidth * 4.5), Math.max(span, 1));
  const half = length * Math.tan(spread);
  const back = head === 'notched' ? length * 0.65 : length;
  const tip: Point[] =
    head === 'notched'
      ? [end, at(end, -length, -half), at(end, -back), at(end, -length, half)]
      : [end, at(end, -length, -half), at(end, -length, half)];

  // The shaft runs from a round start into the head (past its back, so they join without a gap).
  const r = s.strokeWidth / 2;
  const shaftEnd = Math.max(0, span - back + Math.min(back, length) * 0.4);
  const shaft: Point[] = [at(start, 0, r), at(start, shaftEnd, r), at(start, shaftEnd, -r), at(start, 0, -r)];
  const steps = 12;
  for (let k = 1; k < steps; k++) {
    const phi = (Math.PI * k) / steps;
    shaft.push(at(start, -r * Math.sin(phi), -r * Math.cos(phi)));
  }
  return { start, end, strokes: [], fills: [clockwise(shaft), clockwise(tip)] };
}

/** The same outline, wound one way, so outlines filled together (nonzero) make their union. */
function clockwise(points: Point[]): Point[] {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area < 0 ? [...points].reverse() : points;
}

/** Outlines as an SVG path, each point passed through `pt` (which returns "x,y"). */
export function outlinePath(fills: Point[][], pt: (p: Point) => string = (p) => `${p[0]},${p[1]}`): string {
  return fills.map((poly) => `M${poly.map(pt).join(' L')} Z`).join(' ');
}

/**
 * Turns a point by the shape's angle (degrees clockwise as shown, y down)
 * about the centre of its box: how a turned shape's geometry is placed.
 */
export function shapeTurner(s: Pick<PlacedShape, 'x' | 'y' | 'width' | 'height' | 'angle'>): (p: Point) => Point {
  if (!s.angle) return (p) => p;
  const a = (s.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const cx = s.x + s.width / 2;
  const cy = s.y + s.height / 2;
  return ([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
}

/** A rectangle's or ellipse's outline sits inside its box, so a thick outline doesn't grow it. */
export function insetBox(s: Pick<PlacedShape, 'x' | 'y' | 'width' | 'height' | 'strokeWidth'>) {
  const half = s.strokeWidth / 2;
  return {
    x: s.x + half,
    y: s.y + half,
    width: Math.max(0, s.width - s.strokeWidth),
    height: Math.max(0, s.height - s.strokeWidth),
  };
}

/**
 * Draws shapes onto the exported pages. Coordinates go through the same
 * pdf.js viewport the editor showed, so shapes land where they were drawn on
 * any page rotation.
 */
export async function drawShapes(
  pdfDoc: PDFDocument,
  pdfjsDoc: PdfDocument,
  shapes: PlacedShape[],
  renderScale: number,
  rotation: number,
  recorder?: EditableItemRecorder,
): Promise<void> {
  for (const s of shapes) {
    const page = pdfDoc.getPage(s.page - 1);
    recorder?.begin(page);
    await drawShape(page, pdfjsDoc, s, renderScale, rotation);
    recorder?.end(page, 'shape', s);
  }
}

async function drawShape(
  page: PDFPage,
  pdfjsDoc: PdfDocument,
  s: PlacedShape,
  renderScale: number,
  rotation: number,
): Promise<void> {
  const pdfjsPage = await pdfjsDoc.getPage(s.page);
  const viewport = pdfjsPage.getViewport({ scale: renderScale, rotation: getTotalRotation(pdfjsPage, rotation) });
  const turn = shapeTurner(s);
  const toPdf = (x: number, y: number) => viewport.convertToPdfPoint(...turn([x, y])) as Point;
  const thickness = s.strokeWidth / renderScale;
  const stroke = hexToRgb(s.stroke);

  if (s.kind === 'line' || s.kind === 'arrow') {
    if (thickness <= 0) return;
    const { strokes, fills } = lineGeometry(s);
    if (fills.length) {
      // drawSvgPath flips y, hence the minus.
      const d = outlinePath(fills, (p) => {
        const [px, py] = toPdf(...p);
        return `${px},${-py}`;
      });
      page.drawSvgPath(d, { x: 0, y: 0, color: stroke, opacity: s.opacity });
    }
    for (const [a, b] of strokes) {
      const [x1, y1] = toPdf(...a);
      const [x2, y2] = toPdf(...b);
      page.drawLine({
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        thickness,
        color: stroke,
        opacity: s.opacity,
        lineCap: LineCapStyle.Round,
      });
    }
    return;
  }

  if (thickness <= 0 && !s.fill) return;
  const box = insetBox(s);
  const paint = {
    color: s.fill ? hexToRgb(s.fill) : undefined,
    opacity: s.opacity,
    borderColor: thickness > 0 ? stroke : undefined,
    borderWidth: thickness,
    borderOpacity: s.opacity,
  };

  if (s.angle) {
    // A turned shape is drawn as a path, every point turned and mapped to the
    // page. Both are affine, so the ellipse's Bézier arcs stay exact.
    // drawSvgPath flips y, hence the minus.
    const pt = (x: number, y: number) => {
      const [px, py] = toPdf(x, y);
      return `${px},${-py}`;
    };
    const { x: l, y: t, width: w, height: h } = box;
    let d: string;
    if (s.kind === 'rectangle') {
      d = `M${pt(l, t)} L${pt(l + w, t)} L${pt(l + w, t + h)} L${pt(l, t + h)} Z`;
    } else {
      // Four quarter arcs, the usual cubic approximation of a circle.
      const k = 0.5523;
      const cx = l + w / 2;
      const cy = t + h / 2;
      const rx = w / 2;
      const ry = h / 2;
      d =
        `M${pt(cx + rx, cy)} ` +
        `C${pt(cx + rx, cy + ry * k)} ${pt(cx + rx * k, cy + ry)} ${pt(cx, cy + ry)} ` +
        `C${pt(cx - rx * k, cy + ry)} ${pt(cx - rx, cy + ry * k)} ${pt(cx - rx, cy)} ` +
        `C${pt(cx - rx, cy - ry * k)} ${pt(cx - rx * k, cy - ry)} ${pt(cx, cy - ry)} ` +
        `C${pt(cx + rx * k, cy - ry)} ${pt(cx + rx, cy - ry * k)} ${pt(cx + rx, cy)} Z`;
    }
    page.drawSvgPath(d, { x: 0, y: 0, ...paint });
    return;
  }

  const [x1, y1] = toPdf(box.x, box.y);
  const [x2, y2] = toPdf(box.x + box.width, box.y + box.height);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  if (s.kind === 'rectangle') page.drawRectangle({ x, y, width, height, ...paint });
  else page.drawEllipse({ x: x + width / 2, y: y + height / 2, xScale: width / 2, yScale: height / 2, ...paint });
}

/**
 * Draws placed images onto the exported pages, upright as they were shown:
 * the image's bottom-left corner on screen is the anchor, and it's turned
 * against the page's rotation (as the page numbers are).
 */
export async function drawImages(
  pdfDoc: PDFDocument,
  pdfjsDoc: PdfDocument,
  images: PlacedImage[],
  imageFor: (id: string) => StoredImage | undefined,
  renderScale: number,
  rotation: number,
  recorder?: EditableItemRecorder,
): Promise<void> {
  // Each image is embedded once, however many times it's placed.
  const embedded = new Map<string, PDFImage>();
  for (const placed of images) {
    const stored = imageFor(placed.imageId);
    if (!stored) continue;
    let image = embedded.get(placed.imageId);
    if (!image) {
      const bytes = new Uint8Array(await stored.blob.arrayBuffer());
      image = stored.type === 'png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      embedded.set(placed.imageId, image);
    }

    const pdfjsPage = await pdfjsDoc.getPage(placed.page);
    const totalRotation = getTotalRotation(pdfjsPage, rotation);
    const viewport = pdfjsPage.getViewport({ scale: renderScale, rotation: totalRotation });
    const [x, y] = viewport.convertToPdfPoint(placed.x, placed.y + placed.height);
    const page = pdfDoc.getPage(placed.page - 1);
    recorder?.begin(page);
    page.drawImage(image, {
      x,
      y,
      width: placed.width / renderScale,
      height: placed.height / renderScale,
      rotate: degrees(totalRotation),
      opacity: placed.opacity,
    });
    recorder?.end(page, 'image', placed, image.ref);
  }
}
