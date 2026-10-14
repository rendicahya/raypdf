import { renderPageToCanvas, type PdfDocument } from './loader';

/** An area of the page as fractions (0–1) of its width/height, so it's independent of zoom. */
export interface CaptureArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Captures are rendered fresh at a fixed, generous scale rather than copied
// off the on-screen canvas, so a screenshot taken while zoomed out is still crisp.
const CAPTURE_SCALE = 3;

/**
 * Renders a page (with the user's extra rotation applied) and returns it, or
 * the given area of it, as a PNG. Only the PDF's own content is captured —
 * signatures, text boxes, and other overlays are still unsaved edits at
 * this point and live in the HTML on top of the canvas, not in the page.
 */
export async function capturePage(
  pdfDoc: PdfDocument,
  pageNumber: number,
  rotation: number,
  area: CaptureArea | null,
): Promise<Blob> {
  const pageCanvas = document.createElement('canvas');
  await renderPageToCanvas(pdfDoc, pageNumber, pageCanvas, CAPTURE_SCALE, rotation);

  let output = pageCanvas;
  if (area) {
    const sx = Math.round(area.x * pageCanvas.width);
    const sy = Math.round(area.y * pageCanvas.height);
    const sw = Math.max(1, Math.round(area.width * pageCanvas.width));
    const sh = Math.max(1, Math.round(area.height * pageCanvas.height));
    output = document.createElement('canvas');
    output.width = sw;
    output.height = sh;
    const ctx = output.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  }

  return new Promise((resolve, reject) =>
    output.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to create the image'))), 'image/png'),
  );
}

/**
 * Puts a PNG on the clipboard; returns false if the browser doesn't allow it.
 * Takes the still-rendering image as a promise so this can be called straight
 * from the click handler — browsers only allow clipboard writes during a
 * user gesture, which would have lapsed by the time a big render finishes.
 */
export async function copyImageToClipboard(png: Promise<Blob>): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
