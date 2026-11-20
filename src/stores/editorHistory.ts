// Undo/redo for the editor store, one history per document. It lives outside
// the reactive store: nothing about it needs to drive rendering on its own,
// only canUndo/canRedo do, and those are answered on demand from `tick`.
import { writable } from 'svelte/store';
import { clamp } from './editorGeometry';
import type { PdfDocumentState } from './editorTypes';

/** The part of a document that undo/redo tracks: everything the user places or
 * changes on it, but not navigation (page number) or the "saved yet" flag. */
type DocSnapshot = Pick<
  PdfDocumentState,
  | 'file' // replaced by page edits (move, delete, …), so undo/redo can swap it back
  | 'pageCount' // kept with `file`, so the page count is right the moment it's swapped
  | 'placedSignatures'
  | 'redactions'
  | 'texts'
  | 'comments'
  | 'highlights'
  | 'shapes'
  | 'images'
  | 'formValues'
  | 'pageNumbers'
  | 'headerFooter'
  | 'pageWatermark'
  | 'rotation'
>;

export interface DocHistory {
  past: DocSnapshot[];
  future: DocSnapshot[];
}

const MAX_HISTORY = 50;
// Repeated calls that share an action key within this window collapse into
// the single history entry taken before the first of them; otherwise every
// pointermove during a drag, every tick of a range slider, or every repeat
// of a held-down arrow key would each get their own undo step.
const HISTORY_COALESCE_MS = 600;

function snapshotOf(doc: PdfDocumentState): DocSnapshot {
  return {
    file: doc.file,
    pageCount: doc.pageCount,
    placedSignatures: doc.placedSignatures,
    redactions: doc.redactions,
    texts: doc.texts,
    comments: doc.comments,
    highlights: doc.highlights,
    shapes: doc.shapes,
    images: doc.images,
    formValues: doc.formValues,
    pageNumbers: doc.pageNumbers,
    headerFooter: doc.headerFooter,
    pageWatermark: doc.pageWatermark,
    rotation: doc.rotation,
  };
}

function applySnapshot(doc: PdfDocumentState, snap: DocSnapshot): PdfDocumentState {
  return { ...doc, ...snap, pageNumber: clamp(doc.pageNumber, 1, snap.pageCount), exported: false };
}

export function createHistory() {
  const histories = new Map<string, DocHistory>();
  const lastActionKeys = new Map<string, { key: string; time: number }>();
  /** Bumped whenever any history changes. */
  const tick = writable(0);

  function get(id: string): DocHistory {
    let h = histories.get(id);
    if (!h) {
      h = { past: [], future: [] };
      histories.set(id, h);
    }
    return h;
  }

  /**
   * Records `doc`'s state *before* a change identified by `actionKey`. Calls
   * sharing the same actionKey within HISTORY_COALESCE_MS of each other are
   * one continuous gesture (a drag, a resize, a slider being dragged) and
   * only the first gets an entry. Pass a fresh key (e.g. with
   * crypto.randomUUID()) for actions that should never coalesce, like each
   * add or remove.
   */
  function record(id: string, actionKey: string, doc: PdfDocumentState) {
    const now = Date.now();
    const last = lastActionKeys.get(id);
    const coalescing = !!last && last.key === actionKey && now - last.time < HISTORY_COALESCE_MS;
    if (!coalescing) {
      const h = get(id);
      h.past.push(snapshotOf(doc));
      if (h.past.length > MAX_HISTORY) h.past.shift();
      h.future = [];
    }
    lastActionKeys.set(id, { key: actionKey, time: now });
    tick.update((n) => n + 1);
  }

  function clear(id: string) {
    histories.delete(id);
    lastActionKeys.delete(id);
  }

  function clearAll() {
    histories.clear();
    lastActionKeys.clear();
  }

  /**
   * One step back (`undo`) or forward: `doc` as it was or will be, or null
   * when there's no step. The current state goes on the opposite stack.
   */
  function step(doc: PdfDocumentState, direction: 'undo' | 'redo'): PdfDocumentState | null {
    const h = get(doc.id);
    const [from, to] = direction === 'undo' ? [h.past, h.future] : [h.future, h.past];
    const snap = from.pop();
    if (!snap) return null;
    to.push(snapshotOf(doc));
    if (to.length > MAX_HISTORY) to.shift();
    lastActionKeys.delete(doc.id); // whatever comes next shouldn't coalesce with actions from before
    tick.update((n) => n + 1);
    return applySnapshot(doc, snap);
  }

  return { tick, get, record, clear, clearAll, step };
}
