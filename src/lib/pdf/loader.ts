import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PdfDocument = pdfjsLib.PDFDocumentProxy;

/**
 * Loads a PDF entirely in-memory. The file bytes never leave the browser —
 * pdf.js parses the array buffer locally.
 */
export async function loadPdf(file: File, password?: string): Promise<PdfDocument> {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer, password });
  return loadingTask.promise;
}

/** Whether pdf.js refused a file because it needs a password to open (or the one given was wrong). */
export function isPasswordError(e: unknown): boolean {
  return e instanceof Error && e.name === 'PasswordException';
}

/** Whether a password error means the password given was wrong, rather than missing. */
export function isWrongPasswordError(e: unknown): boolean {
  return isPasswordError(e) && (e as { code?: number }).code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
}

/**
 * Combines the page's own intrinsic rotation with any additional rotation
 * the user chose, so a "rotate" button always turns the page relative to
 * what's currently on screen rather than fighting the source PDF's own
 * /Rotate value.
 */
export function getTotalRotation(page: { rotate: number }, extraRotation = 0): number {
  return ((page.rotate + extraRotation) % 360 + 360) % 360;
}

// Tracks the in-flight render "claim" per canvas so a newer render can cancel
// a stale one. pdf.js does not do this on its own — two overlapping render()
// calls on the same canvas race to set canvas.width/height and draw, which
// tears the frame (visible as a corrupted/mirrored page) instead of queuing.
// This can happen whenever something re-triggers a render effect before the
// previous render finished — e.g. "Apply to All Documents" firing several
// rapid store updates, or two `$effect` runs settling in quick succession
// right after a canvas is first mounted.
//
// The claim is staked *before* the first await (doc.getPage is async), not
// after: two calls that start close enough together can otherwise both find
// nothing to cancel yet and both proceed to page.render() on the same
// canvas, which pdf.js rejects outright ("Cannot use the same canvas during
// multiple render() operations"). Restaking the claim synchronously means
// the loser reliably notices, on resuming from its own await, that a newer
// claim has taken over, and bails before ever calling render().
interface RenderClaim {
  task?: ReturnType<PdfPage['render']>;
}
const pendingRenders = new WeakMap<HTMLCanvasElement, RenderClaim>();

type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;

export async function renderPageToCanvas(
  doc: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.5,
  extraRotation = 0,
): Promise<void> {
  pendingRenders.get(canvas)?.task?.cancel();
  const myClaim: RenderClaim = {};
  pendingRenders.set(canvas, myClaim);

  const page = await doc.getPage(pageNumber);
  if (pendingRenders.get(canvas) !== myClaim) return; // superseded while awaiting

  const rotation = getTotalRotation(page, extraRotation);
  const viewport = page.getViewport({ scale, rotation });
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable');

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const renderTask = page.render({ canvas, canvasContext: context, viewport });
  myClaim.task = renderTask;
  try {
    await renderTask.promise;
  } catch (e) {
    // A render cancelled by a newer one isn't a real failure — the newer
    // render will finish and draw the correct frame.
    if (!(e instanceof Error) || e.name !== 'RenderingCancelledException') throw e;
  } finally {
    if (pendingRenders.get(canvas) === myClaim) pendingRenders.delete(canvas);
  }
}
