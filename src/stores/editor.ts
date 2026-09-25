import { writable, derived } from 'svelte/store';
import { getCachedPdf } from '../lib/pdf/docCache';
import { getTotalRotation, type PdfDocument } from '../lib/pdf/loader';

/** Signature instance placed on the page, in canvas pixel coordinates. */
export interface PlacedSignature {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1-indexed page this placement belongs to. */
  page: number;
}

/** A user-drawn area to permanently strip from the exported PDF, in canvas pixel coordinates. */
export interface RedactionBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1-indexed page this box belongs to. */
  page: number;
}

export type TextFontFamily = 'helvetica' | 'times' | 'courier' | 'arial' | 'consolas';

export type TextAlign = 'left' | 'center' | 'right';

/** A typed text box placed on the page, in canvas pixel coordinates. */
export interface PlacedText {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1-indexed page this text belongs to. */
  page: number;
  text: string;
  fontFamily: TextFontFamily;
  /** In canvas pixels at the current render scale — rescaled alongside x/y/width/height on zoom. */
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** CSS hex color. */
  color: string;
  /** In canvas pixels at the current render scale. */
  letterSpacing: number;
  align: TextAlign;
}

/** A sticky-note style comment marker placed on the page, in canvas pixel coordinates. */
export interface PlacedComment {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 1-indexed page this comment belongs to. */
  page: number;
  text: string;
}

/** Per-document editing state — one entry per uploaded PDF. */
export interface PdfDocumentState {
  id: string;
  file: File;
  pageNumber: number;
  pageCount: number;
  placedSignatures: PlacedSignature[];
  redactions: RedactionBox[];
  texts: PlacedText[];
  comments: PlacedComment[];
  /** Additional rotation (0/90/180/270) the user applied on top of the page's own rotation. */
  rotation: number;
  /** Whether the current placement/redactions have been saved/printed — cleared whenever either changes. Used to warn before closing an unsaved tab. */
  exported: boolean;
}

export interface EditorState {
  documents: PdfDocumentState[];
  activeId: string | null;
  /** pdf.js render scale for the visible canvas; shared across documents so switching between them keeps the same zoom level. */
  renderScale: number;
  /** Whether at least one PDF has been downloaded this session — used to warn before a "Start Over" that would discard undownloaded work. */
  hasExported: boolean;
}

export const DEFAULT_RENDER_SCALE = 1.5;
const MIN_RENDER_SCALE = 0.5;
const MAX_RENDER_SCALE = 4;
const ZOOM_STEP = 1.2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createDocumentState(file: File): PdfDocumentState {
  return {
    id: crypto.randomUUID(),
    file,
    pageNumber: 1,
    pageCount: 1,
    placedSignatures: [],
    redactions: [],
    texts: [],
    comments: [],
    rotation: 0,
    exported: false,
  };
}

export function getActiveDocument(state: EditorState): PdfDocumentState | null {
  return state.documents.find((d) => d.id === state.activeId) ?? null;
}

/** Applies `fn` to whichever document is currently active; a no-op if none is. */
function updateActiveDocument(
  state: EditorState,
  fn: (doc: PdfDocumentState) => PdfDocumentState,
): EditorState {
  if (!state.activeId) return state;
  return {
    ...state,
    documents: state.documents.map((doc) => (doc.id === state.activeId ? fn(doc) : doc)),
  };
}

function rescale(state: EditorState, nextScale: number): EditorState {
  const renderScale = clamp(nextScale, MIN_RENDER_SCALE, MAX_RENDER_SCALE);
  const factor = renderScale / state.renderScale;
  // Zoom is shared across every document, so a placement/redaction on any of
  // them — not just the active one — needs to be rescaled to stay over the
  // same spot the next time that document is viewed.
  const documents = state.documents.map((doc) => ({
    ...doc,
    placedSignatures: doc.placedSignatures.map((sig) => ({
      ...sig,
      x: sig.x * factor,
      y: sig.y * factor,
      width: sig.width * factor,
      height: sig.height * factor,
    })),
    redactions: doc.redactions.map((box) => ({
      ...box,
      x: box.x * factor,
      y: box.y * factor,
      width: box.width * factor,
      height: box.height * factor,
    })),
    texts: doc.texts.map((t) => ({
      ...t,
      x: t.x * factor,
      y: t.y * factor,
      width: t.width * factor,
      height: t.height * factor,
      fontSize: t.fontSize * factor,
      letterSpacing: t.letterSpacing * factor,
    })),
    comments: doc.comments.map((c) => ({
      ...c,
      x: c.x * factor,
      y: c.y * factor,
      width: c.width * factor,
      height: c.height * factor,
    })),
  }));
  return { ...state, renderScale, documents };
}

/**
 * Re-derives a box's canvas-pixel position after the page's rotation changes,
 * by round-tripping through pdf.js's own PDF-point conversion (old viewport
 * pixels → PDF points → new viewport pixels) instead of discarding it — a
 * signature or redaction the user placed shouldn't vanish just because they
 * rotated the page afterward.
 */
async function rotateGeometry<T extends { x: number; y: number; width: number; height: number }>(
  pdfjsDoc: PdfDocument,
  pageNumber: number,
  renderScale: number,
  oldRotation: number,
  newRotation: number,
  box: T,
): Promise<T> {
  const page = await pdfjsDoc.getPage(pageNumber);
  const oldViewport = page.getViewport({ scale: renderScale, rotation: getTotalRotation(page, oldRotation) });
  const newViewport = page.getViewport({ scale: renderScale, rotation: getTotalRotation(page, newRotation) });

  const [px1, py1] = oldViewport.convertToPdfPoint(box.x, box.y);
  const [px2, py2] = oldViewport.convertToPdfPoint(box.x + box.width, box.y + box.height);
  const [vx1, vy1] = newViewport.convertToViewportPoint(px1, py1);
  const [vx2, vy2] = newViewport.convertToViewportPoint(px2, py2);

  return {
    ...box,
    x: Math.min(vx1, vx2),
    y: Math.min(vy1, vy2),
    width: Math.abs(vx2 - vx1),
    height: Math.abs(vy2 - vy1),
  };
}

/** The subset of a document's state that undo/redo tracks — everything the
 * user places or changes on the page, but not navigation (page number),
 * loading state (pageCount), or the "saved yet" flag. */
interface DocSnapshot {
  placedSignatures: PlacedSignature[];
  redactions: RedactionBox[];
  texts: PlacedText[];
  comments: PlacedComment[];
  rotation: number;
}

interface DocHistory {
  past: DocSnapshot[];
  future: DocSnapshot[];
}

const MAX_HISTORY = 50;
// Repeated calls that share an action key within this window collapse into
// the single history entry taken before the first of them — otherwise every
// pointermove during a drag, every tick of a range slider, or every repeat
// of a held-down arrow key would each get their own undo step.
const HISTORY_COALESCE_MS = 600;

function createEditorStore() {
  const { subscribe, update, set } = writable<EditorState>({
    documents: [],
    activeId: null,
    renderScale: DEFAULT_RENDER_SCALE,
    hasExported: false,
  });

  // Undo/redo history lives outside the reactive store — nothing about it
  // needs to drive rendering on its own, only canUndo/canRedo do, and those
  // are answered on demand from historyTick below. Keyed by document id so
  // each open document/tab keeps its own independent history.
  const histories = new Map<string, DocHistory>();
  const lastActionKeys = new Map<string, { key: string; time: number }>();
  const historyTick = writable(0);

  function getHistory(id: string): DocHistory {
    let h = histories.get(id);
    if (!h) {
      h = { past: [], future: [] };
      histories.set(id, h);
    }
    return h;
  }

  function snapshotOf(doc: PdfDocumentState): DocSnapshot {
    return {
      placedSignatures: doc.placedSignatures,
      redactions: doc.redactions,
      texts: doc.texts,
      comments: doc.comments,
      rotation: doc.rotation,
    };
  }

  function applySnapshot(doc: PdfDocumentState, snap: DocSnapshot): PdfDocumentState {
    return { ...doc, ...snap, exported: false };
  }

  // Records `doc`'s state *before* a mutation identified by `actionKey`.
  // Calls sharing the same actionKey within HISTORY_COALESCE_MS of each
  // other are treated as one continuous gesture (a drag, a resize, a slider
  // being dragged) and don't get their own history entry — only the first
  // one does. Pass a fresh/unique key (e.g. via crypto.randomUUID()) for
  // actions that should never coalesce, like each individual add/remove.
  function recordHistory(id: string, actionKey: string, doc: PdfDocumentState) {
    const now = Date.now();
    const last = lastActionKeys.get(id);
    const coalescing = !!last && last.key === actionKey && now - last.time < HISTORY_COALESCE_MS;
    if (!coalescing) {
      const h = getHistory(id);
      h.past.push(snapshotOf(doc));
      if (h.past.length > MAX_HISTORY) h.past.shift();
      h.future = [];
    }
    lastActionKeys.set(id, { key: actionKey, time: now });
    historyTick.update((n) => n + 1);
  }

  function clearHistory(id: string) {
    histories.delete(id);
    lastActionKeys.delete(id);
  }

  // Synchronous snapshot of the current state, for the rare action (rotate)
  // that needs to read-before an `await` rather than just transform via `update`.
  function currentState(): EditorState {
    let value: EditorState | undefined;
    subscribe((v) => {
      value = v;
    })();
    return value!;
  }

  function recordActiveHistory(actionKey: string) {
    const doc = getActiveDocument(currentState());
    if (doc) recordHistory(doc.id, actionKey, doc);
  }

  // A document's real page count isn't known until pdf.js has actually
  // parsed it — resolve it eagerly for every uploaded document (not just
  // whichever one is active) so features like "Apply to All Documents" can
  // reliably tell which documents are single-page without waiting for the
  // user to have opened each one first.
  function resolvePageCount(doc: PdfDocumentState) {
    getCachedPdf(doc.id, doc.file)
      .then((pdfjsDoc) => setPageCountForDocument(doc.id, pdfjsDoc.numPages))
      .catch(() => {
        // Leave pageCount at its default; PDFViewer surfaces the real load error when the document is opened.
      });
  }

  /** Replaces the whole document list, e.g. the initial upload. */
  function loadPdfs(files: File[]) {
    histories.clear();
    lastActionKeys.clear();
    const documents = files.map(createDocumentState);
    set({
      documents,
      activeId: documents[0]?.id ?? null,
      renderScale: DEFAULT_RENDER_SCALE,
      hasExported: false,
    });
    documents.forEach(resolvePageCount);
  }

  /** Appends more PDFs to an already-started session. */
  function addPdfs(files: File[]) {
    const added = files.map(createDocumentState);
    update((state) => ({
      ...state,
      documents: [...state.documents, ...added],
      activeId: state.activeId ?? added[0]?.id ?? null,
    }));
    added.forEach(resolvePageCount);
  }

  function removeDocument(id: string) {
    clearHistory(id);
    update((state) => {
      const removedIndex = state.documents.findIndex((d) => d.id === id);
      if (removedIndex === -1) return state;

      const documents = state.documents.filter((d) => d.id !== id);
      const activeId =
        state.activeId === id
          ? (documents[Math.min(removedIndex, documents.length - 1)]?.id ?? null)
          : state.activeId;

      return { ...state, documents, activeId };
    });
  }

  function setActiveDocument(id: string) {
    update((state) => (state.documents.some((d) => d.id === id) ? { ...state, activeId: id } : state));
  }

  function prevDocument() {
    update((state) => {
      const index = state.documents.findIndex((d) => d.id === state.activeId);
      if (index <= 0) return state;
      return { ...state, activeId: state.documents[index - 1].id };
    });
  }

  function nextDocument() {
    update((state) => {
      const index = state.documents.findIndex((d) => d.id === state.activeId);
      if (index === -1 || index >= state.documents.length - 1) return state;
      return { ...state, activeId: state.documents[index + 1].id };
    });
  }

  function setPageCount(count: number) {
    update((state) => updateActiveDocument(state, (doc) => ({ ...doc, pageCount: Math.max(1, count) })));
  }

  /** Sets the page count on an arbitrary document, not just the active one. */
  function setPageCountForDocument(id: string, count: number) {
    update((state) => ({
      ...state,
      documents: state.documents.map((doc) => (doc.id === id ? { ...doc, pageCount: Math.max(1, count) } : doc)),
    }));
  }

  function goToPage(page: number) {
    update((state) =>
      updateActiveDocument(state, (doc) => ({ ...doc, pageNumber: clamp(page, 1, doc.pageCount) })),
    );
  }

  function nextPage() {
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        pageNumber: clamp(doc.pageNumber + 1, 1, doc.pageCount),
      })),
    );
  }

  function prevPage() {
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        pageNumber: clamp(doc.pageNumber - 1, 1, doc.pageCount),
      })),
    );
  }

  function addSignature(placement: Omit<PlacedSignature, 'id'>): string {
    const id = crypto.randomUUID();
    recordActiveHistory(`add-signature-${id}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        placedSignatures: [...doc.placedSignatures, { ...placement, id }],
        exported: false,
      })),
    );
    return id;
  }

  function removeSignature(id: string) {
    recordActiveHistory(`remove-signature-${id}-${Date.now()}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        placedSignatures: doc.placedSignatures.filter((sig) => sig.id !== id),
        exported: false,
      })),
    );
  }

  function updateSignature(id: string, partial: Partial<PlacedSignature>) {
    recordActiveHistory(`update-signature-${id}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        placedSignatures: doc.placedSignatures.map((sig) => (sig.id === id ? { ...sig, ...partial } : sig)),
        exported: false,
      })),
    );
  }

  /**
   * Replaces the active document's entire signature set — used by "Apply
   * Signature to All Pages" to replicate one page's placement(s) across
   * every page of the same document. Unlike setSignaturesForDocument below
   * (which targets other documents for a cross-document sync), this is a
   * same-document edit and goes through the active document's own undo
   * history like any other placement change.
   */
  function applySignaturesToAllPages(placements: Omit<PlacedSignature, 'id'>[]) {
    recordActiveHistory(`apply-signature-all-pages-${crypto.randomUUID()}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        placedSignatures: placements.map((placement) => ({ ...placement, id: crypto.randomUUID() })),
        exported: false,
      })),
    );
  }

  /** Replaces an arbitrary document's entire signature set (not just the active one) — used by "Apply to All" to make every document have the same placement. */
  function setSignaturesForDocument(id: string, placements: Omit<PlacedSignature, 'id'>[]) {
    update((state) => ({
      ...state,
      documents: state.documents.map((doc) =>
        doc.id === id
          ? {
              ...doc,
              placedSignatures: placements.map((placement) => ({ ...placement, id: crypto.randomUUID() })),
              exported: false,
            }
          : doc,
      ),
    }));
  }

  function addRedaction(box: Omit<RedactionBox, 'id'>) {
    recordActiveHistory(`add-redaction-${crypto.randomUUID()}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        redactions: [...doc.redactions, { ...box, id: crypto.randomUUID() }],
        exported: false,
      })),
    );
  }

  function updateRedaction(id: string, partial: Partial<RedactionBox>) {
    recordActiveHistory(`update-redaction-${id}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        redactions: doc.redactions.map((box) => (box.id === id ? { ...box, ...partial } : box)),
        exported: false,
      })),
    );
  }

  function removeRedaction(id: string) {
    recordActiveHistory(`remove-redaction-${id}-${Date.now()}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        redactions: doc.redactions.filter((box) => box.id !== id),
        exported: false,
      })),
    );
  }

  /** Replaces an arbitrary document's entire redaction set (not just the active one) — used by "Apply to All" to make every other document match the active one exactly. */
  function setRedactionsForDocument(id: string, boxes: Omit<RedactionBox, 'id'>[]) {
    update((state) => ({
      ...state,
      documents: state.documents.map((doc) =>
        doc.id === id
          ? {
              ...doc,
              redactions: boxes.map((box) => ({ ...box, id: crypto.randomUUID() })),
              exported: false,
            }
          : doc,
      ),
    }));
  }

  function addText(text: Omit<PlacedText, 'id'>): string {
    const id = crypto.randomUUID();
    recordActiveHistory(`add-text-${id}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        texts: [...doc.texts, { ...text, id }],
        exported: false,
      })),
    );
    return id;
  }

  function updateText(id: string, partial: Partial<PlacedText>) {
    recordActiveHistory(`update-text-${id}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        texts: doc.texts.map((t) => (t.id === id ? { ...t, ...partial } : t)),
        exported: false,
      })),
    );
  }

  function removeText(id: string) {
    recordActiveHistory(`remove-text-${id}-${Date.now()}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        texts: doc.texts.filter((t) => t.id !== id),
        exported: false,
      })),
    );
  }

  /** Replaces an arbitrary document's entire text set (not just the active one) — mirrors setSignaturesForDocument/setRedactionsForDocument for "Apply to All". */
  function setTextsForDocument(id: string, items: Omit<PlacedText, 'id'>[]) {
    update((state) => ({
      ...state,
      documents: state.documents.map((doc) =>
        doc.id === id
          ? {
              ...doc,
              texts: items.map((item) => ({ ...item, id: crypto.randomUUID() })),
              exported: false,
            }
          : doc,
      ),
    }));
  }

  function addComment(comment: Omit<PlacedComment, 'id'>): string {
    const id = crypto.randomUUID();
    recordActiveHistory(`add-comment-${id}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        comments: [...doc.comments, { ...comment, id }],
        exported: false,
      })),
    );
    return id;
  }

  function updateComment(id: string, partial: Partial<PlacedComment>) {
    recordActiveHistory(`update-comment-${id}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        comments: doc.comments.map((c) => (c.id === id ? { ...c, ...partial } : c)),
        exported: false,
      })),
    );
  }

  function removeComment(id: string) {
    recordActiveHistory(`remove-comment-${id}-${Date.now()}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        comments: doc.comments.filter((c) => c.id !== id),
        exported: false,
      })),
    );
  }

  /** Replaces an arbitrary document's entire comment set (not just the active one) — mirrors setTextsForDocument for "Apply to All". */
  function setCommentsForDocument(id: string, items: Omit<PlacedComment, 'id'>[]) {
    update((state) => ({
      ...state,
      documents: state.documents.map((doc) =>
        doc.id === id
          ? {
              ...doc,
              comments: items.map((item) => ({ ...item, id: crypto.randomUUID() })),
              exported: false,
            }
          : doc,
      ),
    }));
  }

  /** Marks a specific document as saved/printed in its current placement — clears the "signed but not downloaded" warning for that tab. */
  function markDocumentExported(id: string) {
    update((state) => ({
      ...state,
      hasExported: true,
      documents: state.documents.map((doc) => (doc.id === id ? { ...doc, exported: true } : doc)),
    }));
  }

  function setRenderScale(nextScale: number) {
    update((state) => rescale(state, nextScale));
  }

  function zoomIn() {
    update((state) => rescale(state, state.renderScale * ZOOM_STEP));
  }

  function zoomOut() {
    update((state) => rescale(state, state.renderScale / ZOOM_STEP));
  }

  function resetZoom() {
    update((state) => rescale(state, DEFAULT_RENDER_SCALE));
  }

  async function rotateBy(delta: number) {
    const state = currentState();
    const doc = getActiveDocument(state);
    if (!doc) return;

    const { id, file, rotation: oldRotation, placedSignatures, redactions, texts, comments } = doc;
    const { renderScale } = state;
    const newRotation = (((oldRotation + delta) % 360) + 360) % 360;

    recordHistory(id, `rotate-${crypto.randomUUID()}`, doc);

    const applyRotation = (
      placements: PlacedSignature[],
      boxes: RedactionBox[],
      newTexts: PlacedText[],
      newComments: PlacedComment[],
    ) => {
      update((state) => ({
        ...state,
        // Target this specific document rather than "whichever is active
        // now" — the pdf.js work below is async, so the user could have
        // switched tabs before it resolves.
        documents: state.documents.map((d) =>
          d.id === id
            ? {
                ...d,
                rotation: newRotation,
                placedSignatures: placements,
                redactions: boxes,
                texts: newTexts,
                comments: newComments,
                exported: false,
              }
            : d,
        ),
      }));
    };

    try {
      const pdfjsDoc = await getCachedPdf(id, file);
      const newPlacements = await Promise.all(
        placedSignatures.map((sig) =>
          rotateGeometry(pdfjsDoc, sig.page, renderScale, oldRotation, newRotation, sig),
        ),
      );
      const newRedactions = await Promise.all(
        redactions.map((box) => rotateGeometry(pdfjsDoc, box.page, renderScale, oldRotation, newRotation, box)),
      );
      const newTexts = await Promise.all(
        texts.map((t) => rotateGeometry(pdfjsDoc, t.page, renderScale, oldRotation, newRotation, t)),
      );
      const newComments = await Promise.all(
        comments.map((c) => rotateGeometry(pdfjsDoc, c.page, renderScale, oldRotation, newRotation, c)),
      );
      applyRotation(newPlacements, newRedactions, newTexts, newComments);
    } catch {
      // Couldn't re-derive the geometry (e.g. the PDF failed to load) — fall
      // back to clearing rather than leaving stale, now-misaligned positions.
      applyRotation([], [], [], []);
    }
  }

  function rotateLeft() {
    rotateBy(-90);
  }

  function rotateRight() {
    rotateBy(90);
  }

  function markExported() {
    update((state) => ({ ...state, hasExported: true }));
  }

  function reset() {
    histories.clear();
    lastActionKeys.clear();
    set({ documents: [], activeId: null, renderScale: DEFAULT_RENDER_SCALE, hasExported: false });
  }

  function undo() {
    const doc = getActiveDocument(currentState());
    if (!doc) return;
    const h = getHistory(doc.id);
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(snapshotOf(doc));
    if (h.future.length > MAX_HISTORY) h.future.shift();
    lastActionKeys.delete(doc.id); // whatever comes next shouldn't coalesce with actions from before the undo
    update((state) => ({
      ...state,
      documents: state.documents.map((d) => (d.id === doc.id ? applySnapshot(d, prev) : d)),
    }));
    historyTick.update((n) => n + 1);
  }

  function redo() {
    const doc = getActiveDocument(currentState());
    if (!doc) return;
    const h = getHistory(doc.id);
    const next = h.future.pop();
    if (!next) return;
    h.past.push(snapshotOf(doc));
    if (h.past.length > MAX_HISTORY) h.past.shift();
    lastActionKeys.delete(doc.id);
    update((state) => ({
      ...state,
      documents: state.documents.map((d) => (d.id === doc.id ? applySnapshot(d, next) : d)),
    }));
    historyTick.update((n) => n + 1);
  }

  return {
    subscribe,
    historyTick,
    getHistory,
    loadPdfs,
    addPdfs,
    removeDocument,
    setActiveDocument,
    prevDocument,
    nextDocument,
    setPageCount,
    setPageCountForDocument,
    goToPage,
    nextPage,
    prevPage,
    addSignature,
    removeSignature,
    updateSignature,
    applySignaturesToAllPages,
    setSignaturesForDocument,
    addRedaction,
    updateRedaction,
    removeRedaction,
    setRedactionsForDocument,
    addText,
    updateText,
    removeText,
    setTextsForDocument,
    addComment,
    updateComment,
    removeComment,
    setCommentsForDocument,
    markDocumentExported,
    setRenderScale,
    zoomIn,
    zoomOut,
    resetZoom,
    rotateLeft,
    rotateRight,
    markExported,
    undo,
    redo,
    reset,
  };
}

export const editorStore = createEditorStore();

/** The document currently shown in the editor, if any. */
export const activeDocument = derived(editorStore, getActiveDocument);

/** Whether the active document has an undo/redo step available — drives the toolbar's Undo/Redo buttons. */
export const canUndo = derived(
  [editorStore, editorStore.historyTick],
  ([$editor]) => (!$editor.activeId ? false : editorStore.getHistory($editor.activeId).past.length > 0),
);
export const canRedo = derived(
  [editorStore, editorStore.historyTick],
  ([$editor]) => (!$editor.activeId ? false : editorStore.getHistory($editor.activeId).future.length > 0),
);
