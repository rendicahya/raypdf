import { AbortException, TextLayer } from 'pdfjs-dist';
import type { PdfDocument } from './loader';
import { getTotalRotation } from './loader';

export interface TextLayerHandle {
  cancel: () => void;
}

// Same "claim" pattern as loader.ts's renderPageToCanvas, and for the same
// reason: this container can get a new render() requested (new page, new
// zoom, new rotation) before the previous one — which streams the page's
// text content asynchronously — has finished appending its <span>s. Without
// tracking which call is current, a slow, now-stale render could finish
// after a newer one and clobber it with the wrong page's (invisible, but
// very much selectable/copyable) text.
interface RenderClaim {
  layer?: TextLayer;
}
const pendingRenders = new WeakMap<HTMLDivElement, RenderClaim>();

/**
 * Renders pdf.js's built-in TextLayer — an invisible grid of positioned
 * <span> elements holding the page's real text — into `container`, stacked
 * on top of the already-rendered canvas. This is what lets users click-drag
 * to select and copy text, without RayPDF ever drawing the text itself.
 *
 * Uses the exact same scale + combined rotation as renderPageToCanvas so the
 * invisible spans line up with the glyphs painted on the canvas beneath
 * them. `--scale-factor` drives pdf.js's own span-positioning CSS (see
 * app.css's `.pdf-text-layer` rules).
 *
 * Returns null if superseded by a newer call before it could finish —
 * callers don't need to do anything in that case, since the newer call owns
 * the container from here on.
 */
export async function renderTextLayer(
  doc: PdfDocument,
  pageNumber: number,
  container: HTMLDivElement,
  scale: number,
  extraRotation = 0,
): Promise<TextLayerHandle | null> {
  pendingRenders.get(container)?.layer?.cancel();
  const myClaim: RenderClaim = {};
  pendingRenders.set(container, myClaim);

  const page = await doc.getPage(pageNumber);
  if (pendingRenders.get(container) !== myClaim) return null; // superseded while awaiting

  const rotation = getTotalRotation(page, extraRotation);
  const viewport = page.getViewport({ scale, rotation });

  container.replaceChildren();
  container.style.setProperty('--scale-factor', String(scale));

  const layer = new TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
  myClaim.layer = layer;

  let current = false;
  try {
    await layer.render();
  } catch (e) {
    // A render cancelled by a newer one isn't a real failure — the newer
    // render owns the container and will finish building it.
    if (!(e instanceof AbortException)) throw e;
  } finally {
    current = pendingRenders.get(container) === myClaim;
    if (current) pendingRenders.delete(container);
  }

  if (!current) return null; // superseded while rendering
  layer.textDivs.forEach((span, index) => itemIndices.set(span, index));
  return { cancel: () => layer.cancel() };
}

// Each span's place among the page's text content items (those with a `str`,
// which is every item without marked content), so a selection can be traced
// back to the items it covers (lib/pdf/fontInfo.ts).
const itemIndices = new WeakMap<HTMLElement, number>();

/** Indices of the text content items whose spans `range` touches, in order. */
export function textItemIndices(container: HTMLElement, range: Range): number[] {
  const indices: number[] = [];
  for (const span of container.querySelectorAll('span')) {
    const index = itemIndices.get(span);
    if (index !== undefined && span.textContent && range.intersectsNode(span)) indices.push(index);
  }
  return indices;
}

/**
 * Cancels whatever renderTextLayer() call currently owns `container` (in
 * flight or already finished) and empties it. Used when leaving Select Text
 * mode or tearing down the viewer, where nothing will naturally supersede
 * the current render the way a fresh renderTextLayer() call does.
 */
export function cancelTextLayer(container: HTMLDivElement): void {
  pendingRenders.get(container)?.layer?.cancel();
  pendingRenders.delete(container);
  container.replaceChildren();
}
