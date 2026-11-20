// Pure geometry for the editor store: zoom rescaling, and mapping placed
// items between page views (rotation, rewritten files).
import { getTotalRotation, type PdfDocument } from '../lib/pdf/loader';
import {
  PAGE_ITEM_LISTS,
  SCALED_FIELDS,
  type EditorState,
  type Geometry,
  type PageItem,
  type PageItems,
} from './editorTypes';

export const DEFAULT_RENDER_SCALE = 1.5;
const MIN_RENDER_SCALE = 0.5;
const MAX_RENDER_SCALE = 4;
export const ZOOM_STEP = 1.2;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** A copy of an item from `list` with its pixel sizes multiplied by `factor`. */
export function scaleItem<T extends object>(list: keyof PageItems, item: T, factor: number): T {
  const out = { ...item } as Record<string, unknown>;
  for (const field of SCALED_FIELDS[list]) {
    if (typeof out[field] === 'number') out[field] = (out[field] as number) * factor;
  }
  return out as T;
}

/**
 * The state at a new zoom level. Zoom is shared across every document, so
 * what's placed on any of them, not just the active one, is rescaled to stay
 * over the same spot the next time that document is viewed.
 */
export function rescale(state: EditorState, nextScale: number): EditorState {
  const renderScale = clamp(nextScale, MIN_RENDER_SCALE, MAX_RENDER_SCALE);
  const factor = renderScale / state.renderScale;
  const documents = state.documents.map((doc) => {
    const scaled = { ...doc };
    for (const list of PAGE_ITEM_LISTS) {
      (scaled[list] as PageItem[]) = (doc[list] as PageItem[]).map((item) => scaleItem(list, item, factor));
    }
    return scaled;
  });
  return { ...state, renderScale, documents };
}
/**
 * Re-derives a box's canvas-pixel position after the page's rotation changes,
 * by round-tripping through pdf.js's own PDF-point conversion (old viewport
 * pixels → PDF points → new viewport pixels) instead of discarding it — a
 * signature or redaction the user placed shouldn't vanish just because they
 * rotated the page afterward.
 */
export function rotateGeometry<T extends Geometry>(
  pdfjsDoc: PdfDocument,
  pageNumber: number,
  renderScale: number,
  oldRotation: number,
  newRotation: number,
  box: T,
): Promise<T> {
  return convertGeometry(
    { pdfjsDoc, pageNumber, rotation: oldRotation },
    { pdfjsDoc, pageNumber, rotation: newRotation },
    renderScale,
    box,
  );
}

/**
 * The general form of rotateGeometry: maps a box from one page view to
 * another — possibly in a different version of the file, e.g. after a single
 * page's own rotation was changed by rewriting the PDF.
 */
export async function convertGeometry<T extends Geometry>(
  from: { pdfjsDoc: PdfDocument; pageNumber: number; rotation: number },
  to: { pdfjsDoc: PdfDocument; pageNumber: number; rotation: number },
  renderScale: number,
  box: T,
): Promise<T> {
  const oldPage = await from.pdfjsDoc.getPage(from.pageNumber);
  const newPage = await to.pdfjsDoc.getPage(to.pageNumber);
  const oldViewport = oldPage.getViewport({ scale: renderScale, rotation: getTotalRotation(oldPage, from.rotation) });
  const newViewport = newPage.getViewport({ scale: renderScale, rotation: getTotalRotation(newPage, to.rotation) });

  // A signature turns with the page instead of being reshaped: its centre
  // follows the content and it keeps its size, turned by as much as the page.
  if ('signatureId' in box) {
    const [pcx, pcy] = oldViewport.convertToPdfPoint(box.x + box.width / 2, box.y + box.height / 2);
    const [cx, cy] = newViewport.convertToViewportPoint(pcx, pcy);
    const turn = newViewport.rotation - oldViewport.rotation;
    const angle = (((((box as T & { angle?: number }).angle ?? 0) + turn) % 360) + 360) % 360;
    return { ...box, x: cx - box.width / 2, y: cy - box.height / 2, angle: angle || undefined };
  }

  const [px1, py1] = oldViewport.convertToPdfPoint(box.x, box.y);
  const [px2, py2] = oldViewport.convertToPdfPoint(box.x + box.width, box.y + box.height);
  const [vx1, vy1] = newViewport.convertToViewportPoint(px1, py1);
  const [vx2, vy2] = newViewport.convertToViewportPoint(px2, py2);

  const converted = {
    ...box,
    x: Math.min(vx1, vx2),
    y: Math.min(vy1, vy2),
    width: Math.abs(vx2 - vx1),
    height: Math.abs(vy2 - vy1),
  };

  // A line runs between two opposite corners; follow its start and end to
  // see which corners they've landed on.
  if ('flipX' in box && 'flipY' in box) {
    const line = box as T & { flipX: boolean; flipY: boolean };
    const toNew = (x: number, y: number) => {
      const [px, py] = oldViewport.convertToPdfPoint(x, y);
      return newViewport.convertToViewportPoint(px, py);
    };
    const [sx, sy] = toNew(line.flipX ? box.x + box.width : box.x, line.flipY ? box.y + box.height : box.y);
    const [ex, ey] = toNew(line.flipX ? box.x : box.x + box.width, line.flipY ? box.y : box.y + box.height);
    return { ...converted, flipX: sx > ex, flipY: sy > ey };
  }
  return converted;
}

/** Runs `fn` over each of a document's item lists, for edits (rotation, page edits) that move all of them alike. */
export async function mapPageItems(
  doc: PageItems,
  fn: <T extends PageItem>(items: T[]) => Promise<T[]>,
): Promise<PageItems> {
  const lists = await Promise.all(PAGE_ITEM_LISTS.map((list) => fn(doc[list] as PageItem[])));
  return Object.fromEntries(PAGE_ITEM_LISTS.map((list, i) => [list, lists[i]])) as unknown as PageItems;
}