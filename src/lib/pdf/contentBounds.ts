import { renderPageToCanvas, type PdfDocument } from './loader';

/** Small, since only the outline of what's on the page matters. */
const SCAN_SCALE = 0.75;
/** How far from white a pixel must be to count as content (0 to 255). */
const INK_THRESHOLD = 24;
/** Room left around the content, as a fraction of the page. */
const PADDING = 0.015;

/**
 * Where the content of a page is: the box around everything that isn't
 * blank paper, as fractions (0 to 1) of the page as shown (rotation
 * included), with a little room around it. Null for an empty page.
 */
export async function findContentBounds(
  pdf: PdfDocument,
  pageNumber: number,
  rotation: number,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const canvas = document.createElement('canvas');
  await renderPageToCanvas(pdf, pageNumber, canvas, SCAN_SCALE, rotation);
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || width === 0 || height === 0) return null;
  const { data } = ctx.getImageData(0, 0, width, height);

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Transparent counts as paper too.
      const ink = data[i + 3] > 0 && 255 - Math.min(data[i], data[i + 1], data[i + 2]) > INK_THRESHOLD;
      if (!ink) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;

  const x1 = Math.max(0, left / width - PADDING);
  const y1 = Math.max(0, top / height - PADDING);
  const x2 = Math.min(1, (right + 1) / width + PADDING);
  const y2 = Math.min(1, (bottom + 1) / height + PADDING);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}
