import { degrees, LineCapStyle, type PDFDocument, type PDFImage } from '@cantoo/pdf-lib';
import { getTotalRotation, type PdfDocument } from './loader';
import { hexToRgb } from './textRender';
import type { PlacedImage, PlacedShape } from '../../stores/editor';
import type { StoredImage } from '../../stores/images';

type Point = [number, number];

/**
 * Where a line or arrow is drawn, in the same units as the shape's box:
 * corner to corner, plus the two strokes of the arrowhead at the end. Shared
 * by the editor (SVG), screenshots (canvas), and export (PDF), so all three
 * match.
 */
export function lineGeometry(s: Pick<PlacedShape, 'x' | 'y' | 'width' | 'height' | 'flipX' | 'flipY' | 'kind' | 'strokeWidth'>) {
  const start: Point = [s.flipX ? s.x + s.width : s.x, s.flipY ? s.y + s.height : s.y];
  const end: Point = [s.flipX ? s.x : s.x + s.width, s.flipY ? s.y : s.y + s.height];
  if (s.kind !== 'arrow') return { start, end, head: [] as Point[][] };
  const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
  const length = Math.max(10, s.strokeWidth * 4);
  const wing = (a: number): Point => [end[0] - length * Math.cos(angle + a), end[1] - length * Math.sin(angle + a)];
  const spread = (28 * Math.PI) / 180;
  return { start, end, head: [[wing(spread), end], [wing(-spread), end]] };
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
): Promise<void> {
  for (const s of shapes) {
    const pdfjsPage = await pdfjsDoc.getPage(s.page);
    const viewport = pdfjsPage.getViewport({ scale: renderScale, rotation: getTotalRotation(pdfjsPage, rotation) });
    const toPdf = (x: number, y: number) => viewport.convertToPdfPoint(x, y) as Point;
    const page = pdfDoc.getPage(s.page - 1);
    const thickness = s.strokeWidth / renderScale;
    const stroke = hexToRgb(s.stroke);

    if (s.kind === 'line' || s.kind === 'arrow') {
      if (thickness <= 0) continue;
      const { start, end, head } = lineGeometry(s);
      for (const [a, b] of [[start, end], ...head]) {
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
      continue;
    }

    if (thickness <= 0 && !s.fill) continue;
    const box = insetBox(s);
    const [x1, y1] = toPdf(box.x, box.y);
    const [x2, y2] = toPdf(box.x + box.width, box.y + box.height);
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    const paint = {
      color: s.fill ? hexToRgb(s.fill) : undefined,
      opacity: s.opacity,
      borderColor: thickness > 0 ? stroke : undefined,
      borderWidth: thickness,
      borderOpacity: s.opacity,
    };
    if (s.kind === 'rectangle') page.drawRectangle({ x, y, width, height, ...paint });
    else page.drawEllipse({ x: x + width / 2, y: y + height / 2, xScale: width / 2, yScale: height / 2, ...paint });
  }
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
    pdfDoc.getPage(placed.page - 1).drawImage(image, {
      x,
      y,
      width: placed.width / renderScale,
      height: placed.height / renderScale,
      rotate: degrees(totalRotation),
      opacity: placed.opacity,
    });
  }
}
