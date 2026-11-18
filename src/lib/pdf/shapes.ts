import { degrees, LineCapStyle, type PDFDocument, type PDFImage, type PDFPage } from '@cantoo/pdf-lib';
import { getTotalRotation, type PdfDocument } from './loader';
import type { EditableItemRecorder } from './editableItems';
import { hexToRgb } from './textRender';
import type { LineStyle, PlacedImage, PlacedShape } from '../../stores/editor';
import type { StoredImage } from '../../stores/images';

type Point = [number, number];

/**
 * Where a line or arrow is drawn, in the same units as the shape's box:
 * corner to corner, with the arrowhead at the end. `strokes` are segments
 * drawn with the line's width and round caps; the first, if any, is the line
 * itself, the only one that takes the line style (an open head's wings stay
 * solid). `fills` are outlines filled in the line's color, all in one path
 * (nonzero, so where they overlap is filled once and a see-through arrow shows
 * no darker seam). A filled head on a solid arrow makes the whole arrow
 * filled: the shaft becomes an outline with a round start. A patterned one
 * keeps its shaft a stroke, ending where the head begins. Shared by the editor
 * (SVG), screenshots (canvas), and export (PDF), so all three match.
 */
export function lineGeometry(
  s: Pick<
    PlacedShape,
    'x' | 'y' | 'width' | 'height' | 'flipX' | 'flipY' | 'kind' | 'strokeWidth' | 'arrowHead' | 'lineStyle'
  >,
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

  if (dashPattern(s.lineStyle, 1)) {
    return { start, end, strokes: [[start, at(start, Math.max(0, span - back))]], fills: [clockwise(tip)] };
  }

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

/**
 * The dash pattern for a line style at a line width (in the same units), or
 * null for solid. Drawn with round caps, which add half the width to each end
 * of a dash, so a 0-length dash is a round dot.
 */
export function dashPattern(style: LineStyle | undefined, width: number): number[] | null {
  const w = Math.max(width, 0.5);
  switch (style) {
    case 'dashed':
      return [3 * w, 3 * w];
    case 'dotted':
      return [0, 2 * w];
    case 'dashdot':
      return [3 * w, 2.5 * w, 0, 2.5 * w];
    default:
      return null;
  }
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

/** One step of an outline: move, line, cubic Bézier (two control points, then the end), or close. */
export type PathOp = ['M' | 'L', Point] | ['C', Point, Point, Point] | ['Z'];

/** The usual cubic approximation of a quarter circle. */
const ARC = 0.5523;

/**
 * A closed shape's outline, in the same units as its box, inside the inset
 * box. Points only go through affine maps after this (turning, page
 * coordinates), so the Bézier curves stay exact everywhere. Closed shapes
 * aren't mirrored by flipX / flipY: they're turned instead. Shared by the
 * editor (SVG), screenshots (canvas), and export (PDF).
 */
export function shapeOutline(s: Pick<PlacedShape, 'kind' | 'x' | 'y' | 'width' | 'height' | 'strokeWidth'>): PathOp[] {
  const { x: l, y: t, width: w, height: h } = insetBox(s);
  // A point at fractions of the box.
  const p = (u: number, v: number): Point => [l + u * w, t + v * h];
  const poly = (pts: Point[]): PathOp[] => [['M', pts[0]], ...pts.slice(1).map((q): PathOp => ['L', q]), ['Z']];
  // Points around the centre (radius 1, starting at the top), stretched to fill the box.
  const around = (radii: number[]): Point[] => {
    const raw = radii.map((r, i): Point => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / radii.length;
      return [r * Math.cos(a), r * Math.sin(a)];
    });
    const xs = raw.map((q) => q[0]);
    const ys = raw.map((q) => q[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return raw.map(([x, y]) => p((x - x0) / (x1 - x0), (y - y0) / (y1 - y0)));
  };

  switch (s.kind) {
    case 'roundedRectangle':
      return roundedBox(l, t, w, h, Math.min(w, h) * 0.2);
    case 'ellipse': {
      const [cx, cy, rx, ry] = [l + w / 2, t + h / 2, w / 2, h / 2];
      const k = ARC;
      return [
        ['M', [cx + rx, cy]],
        ['C', [cx + rx, cy + ry * k], [cx + rx * k, cy + ry], [cx, cy + ry]],
        ['C', [cx - rx * k, cy + ry], [cx - rx, cy + ry * k], [cx - rx, cy]],
        ['C', [cx - rx, cy - ry * k], [cx - rx * k, cy - ry], [cx, cy - ry]],
        ['C', [cx + rx * k, cy - ry], [cx + rx, cy - ry * k], [cx + rx, cy]],
        ['Z'],
      ];
    }
    case 'triangle':
      return poly([p(0.5, 0), p(1, 1), p(0, 1)]);
    case 'rightTriangle':
      return poly([p(0, 0), p(1, 1), p(0, 1)]);
    case 'diamond':
      return poly([p(0.5, 0), p(1, 0.5), p(0.5, 1), p(0, 0.5)]);
    case 'pentagon':
      return poly(around([1, 1, 1, 1, 1]));
    case 'hexagon':
      return poly([p(0.25, 0), p(0.75, 0), p(1, 0.5), p(0.75, 1), p(0.25, 1), p(0, 0.5)]);
    case 'star':
      return poly(around([1, 0.4, 1, 0.4, 1, 0.4, 1, 0.4, 1, 0.4]));
    case 'heart':
      return [
        ['M', p(0.5, 1)],
        ['C', p(0.12, 0.74), p(0, 0.52), p(0, 0.3)],
        ['C', p(0, 0.12), p(0.13, 0), p(0.28, 0)],
        ['C', p(0.39, 0), p(0.47, 0.06), p(0.5, 0.17)],
        ['C', p(0.53, 0.06), p(0.61, 0), p(0.72, 0)],
        ['C', p(0.87, 0), p(1, 0.12), p(1, 0.3)],
        ['C', p(1, 0.52), p(0.88, 0.74), p(0.5, 1)],
        ['Z'],
      ];
    case 'callout': {
      // A rounded body over the top of the box, with a tail down to the bottom left.
      const body = h * 0.78;
      return roundedBox(l, t, w, body, Math.min(w * 0.15, body * 0.25), [
        [l + w * 0.42, t + body],
        [l + w * 0.16, t + h],
        [l + w * 0.24, t + body],
      ]);
    }
    case 'blockArrow': {
      // The head is never longer than it is tall, so a long arrow keeps a long shaft.
      const head = Math.min(0.5, h / Math.max(w, 1));
      return poly([
        p(0, 0.28),
        p(1 - head, 0.28),
        p(1 - head, 0),
        p(1, 0.5),
        p(1 - head, 1),
        p(1 - head, 0.72),
        p(0, 0.72),
      ]);
    }
    default:
      return poly([p(0, 0), p(1, 0), p(1, 1), p(0, 1)]);
  }
}

/** A rectangle with round corners of radius r, clockwise from the top left; `tail` points go into the bottom edge, right to left. */
function roundedBox(l: number, t: number, w: number, h: number, r: number, tail: Point[] = []): PathOp[] {
  const [right, bottom] = [l + w, t + h];
  const k = r * (1 - ARC);
  return [
    ['M', [l + r, t]],
    ['L', [right - r, t]],
    ['C', [right - k, t], [right, t + k], [right, t + r]],
    ['L', [right, bottom - r]],
    ['C', [right, bottom - k], [right - k, bottom], [right - r, bottom]],
    ...tail.map((q): PathOp => ['L', q]),
    ['L', [l + r, bottom]],
    ['C', [l + k, bottom], [l, bottom - k], [l, bottom - r]],
    ['L', [l, t + r]],
    ['C', [l, t + k], [l + k, t], [l + r, t]],
    ['Z'],
  ];
}

/** An outline as SVG path data, each point passed through `pt` (which returns "x,y"). */
export function pathData(ops: PathOp[], pt: (p: Point) => string = (p) => `${p[0]},${p[1]}`): string {
  return ops.map(([op, ...pts]) => op + (pts as Point[]).map(pt).join(' ')).join(' ');
}

/** Traces an outline onto a canvas path (after beginPath). */
export function tracePath(ctx: CanvasRenderingContext2D, ops: PathOp[]): void {
  for (const op of ops) {
    if (op[0] === 'M') ctx.moveTo(...op[1]);
    else if (op[0] === 'L') ctx.lineTo(...op[1]);
    else if (op[0] === 'C') ctx.bezierCurveTo(...op[1], ...op[2], ...op[3]);
    else ctx.closePath();
  }
}

/** A closed shape's outline sits inside its box, so a thick outline doesn't grow it. */
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
  const dashes = dashPattern(s.lineStyle, thickness);

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
    strokes.forEach(([a, b], i) => {
      const [x1, y1] = toPdf(...a);
      const [x2, y2] = toPdf(...b);
      page.drawLine({
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        thickness,
        color: stroke,
        opacity: s.opacity,
        lineCap: LineCapStyle.Round,
        // Only the line itself is patterned, not an open head's wings.
        ...(dashes && i === 0 ? { dashArray: dashes } : {}),
      });
    });
    return;
  }

  if (thickness <= 0 && !s.fill) return;
  // Every point turned and mapped to the page; both are affine, so the
  // Bézier curves stay exact. drawSvgPath flips y, hence the minus.
  const d = pathData(shapeOutline(s), (p) => {
    const [px, py] = toPdf(...p);
    return `${px},${-py}`;
  });
  page.drawSvgPath(d, {
    x: 0,
    y: 0,
    color: s.fill ? hexToRgb(s.fill) : undefined,
    opacity: s.opacity,
    borderColor: thickness > 0 ? stroke : undefined,
    borderWidth: thickness,
    borderOpacity: s.opacity,
    ...(dashes && thickness > 0 ? { borderDashArray: dashes, borderLineCap: LineCapStyle.Round } : {}),
  });
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
