import { getTotalRotation, type PdfDocument } from './loader';
import type { PlacedSignature } from '../../stores/editor';
import type { PlacementRatio } from '../../stores/placement';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Re-derives a pixel placement from a saved ratio for a page that isn't
 * currently rendered on screen, using pdf.js's own viewport math instead of
 * a live canvas. Used to auto-place the signature on documents the user
 * hasn't manually positioned yet (e.g. bulk export), mirroring what
 * PDFViewer's "Use last position" does for the page that's actually visible.
 */
export async function boxFromRatioForDocument(
  pdfjsDoc: PdfDocument,
  pageNumber: number,
  renderScale: number,
  rotation: number,
  ratio: PlacementRatio,
): Promise<{ x: number; y: number; width: number; height: number; page: number }> {
  const page = await pdfjsDoc.getPage(pageNumber);
  const totalRotation = getTotalRotation(page, rotation);
  const viewport = page.getViewport({ scale: renderScale, rotation: totalRotation });

  const width = ratio.widthRatio * viewport.width;
  const height = ratio.heightRatio * viewport.height;

  return {
    width,
    height,
    x: clamp(ratio.xRatio * viewport.width, 0, viewport.width - width),
    y: clamp(ratio.yRatio * viewport.height, 0, viewport.height - height),
    page: pageNumber,
  };
}

/** boxFromRatioForDocument, as a placement of the given saved signature. */
export async function placementFromRatioForDocument(
  pdfjsDoc: PdfDocument,
  pageNumber: number,
  renderScale: number,
  rotation: number,
  ratio: PlacementRatio,
  signatureId: string,
): Promise<PlacedSignature> {
  const box = await boxFromRatioForDocument(pdfjsDoc, pageNumber, renderScale, rotation, ratio);
  return { ...box, id: crypto.randomUUID(), signatureId };
}

/**
 * Reverse of placementFromRatioForDocument — expresses an existing box (in
 * canvas-pixel coordinates for the given page/scale/rotation) as a ratio of
 * the page size, so it can be replicated onto a different page or document.
 * Works for any box shape (signature placement or redaction box).
 */
export async function boxToRatio(
  pdfjsDoc: PdfDocument,
  pageNumber: number,
  renderScale: number,
  rotation: number,
  box: { x: number; y: number; width: number; height: number },
): Promise<PlacementRatio> {
  const page = await pdfjsDoc.getPage(pageNumber);
  const totalRotation = getTotalRotation(page, rotation);
  const viewport = page.getViewport({ scale: renderScale, rotation: totalRotation });

  return {
    xRatio: box.x / viewport.width,
    yRatio: box.y / viewport.height,
    widthRatio: box.width / viewport.width,
    heightRatio: box.height / viewport.height,
  };
}
