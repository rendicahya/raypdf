import { writable, derived } from 'svelte/store';
import { getCachedPdf } from '../lib/pdf/docCache';
import { addStoredImage } from './images';
import { getTotalRotation } from '../lib/pdf/loader';
import type { OcrPage } from '../lib/pdf/ocr';
import type { PageNumberSettings } from '../lib/pdf/pageNumbers';
import type { HeaderFooterSettings } from '../lib/pdf/headerFooter';
import type { PageWatermarkSettings } from '../lib/pdf/pageWatermark';
import {
  ITEM_KINDS,
  ITEM_LISTS,
  type EditorState,
  type Geometry,
  type ItemKind,
  type ItemRef,
  type MarkupKind,
  type PageItem,
  type PageItems,
  type PdfDocumentState,
  type PlacedComment,
  type PlacedImage,
  type PlacedShape,
  type PlacedSignature,
  type PlacedText,
  type RedactionBox,
} from './editorTypes';
import {
  clamp,
  convertGeometry,
  mapPageItems,
  rescale,
  rotateGeometry,
  scaleItem,
  DEFAULT_RENDER_SCALE,
  ZOOM_STEP,
} from './editorGeometry';
import { createHistory } from './editorHistory';

export * from './editorTypes';
export { DEFAULT_RENDER_SCALE } from './editorGeometry';

// pdf-lib is only needed once a file is rewritten, so these load on first use
// (keeping it off the front page's download).
const pageOps = () => import('../lib/pdf/pageOps');
const editableItems = () => import('../lib/pdf/editableItems');
function createDocumentState(file: File): PdfDocumentState {
  return {
    id: crypto.randomUUID(),
    file,
    originalFile: file,
    pageNumber: 1,
    pageCount: 1,
    placedSignatures: [],
    redactions: [],
    texts: [],
    comments: [],
    highlights: [],
    shapes: [],
    images: [],
    formValues: {},
    pageNumbers: null,
    headerFooter: null,
    pageWatermark: null,
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

/** A page-level edit of the active document — see editPages. */
interface PageEdit {
  rewrite: (file: File) => Promise<File>;
  /** Where each old page ends up (1-indexed), or null if it was removed. */
  mapPage: (page: number) => number | null;
  /** The page to show afterwards, given the one being viewed and the new page count. */
  mapCurrent: (page: number, newCount: number) => number;
  /** Old page whose items are copied onto its duplicate (the page right after it). */
  copiesPage?: number;
  /** Old pages whose shape changes (rotation) — their items are re-derived to stay over the same content. */
  reshapesPages?: number[];
}

function createEditorStore() {
  const { subscribe, update, set } = writable<EditorState>({
    documents: [],
    activeId: null,
    renderScale: DEFAULT_RENDER_SCALE,
    hasExported: false,
  });


  // Each open document keeps its own undo/redo history (stores/editorHistory.ts).
  const history = createHistory();
  const recordHistory = history.record;
  const clearHistory = history.clear;
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

  /**
   * Brings back the items an earlier RayPDF save kept editable (see
   * lib/pdf/editableItems.ts): the file loses their drawings and the
   * document gets the items themselves. Becomes the document as opened, so
   * there's nothing to undo and nothing unsaved.
   */
  async function restorePlacedItems(id: string) {
    const doc = currentState().documents.find((d) => d.id === id);
    if (!doc) return;
    const file = doc.file;
    try {
      const pdfjsDoc = await getCachedPdf(id, file);
      const { info } = await pdfjsDoc.getMetadata();
      const { hasEditableItemsMarker, restoreEditableItems } = await editableItems();
      if (!hasEditableItemsMarker(info)) return;
      const restored = await restoreEditableItems(file);
      if (!restored) return;

      let applied = false;
      update((state) => {
        const current = state.documents.find((d) => d.id === id);
        // Changed while this was reading the file: leave it alone.
        if (!current || current.file !== file || current.rotation !== 0) return state;
        applied = true;
        const scale = state.renderScale;
        const placed = { ...current };
        for (const r of restored.items) {
          const base = { id: crypto.randomUUID(), page: r.page };
          if (r.kind === 'text') placed.texts = [...placed.texts, { ...scaleItem('texts', r.item, scale), ...base }];
          else if (r.kind === 'shape') placed.shapes = [...placed.shapes, { ...scaleItem('shapes', r.item, scale), ...base }];
          else placed.images = [...placed.images, { ...scaleItem('images', r.item, scale), imageId: addStoredImage(r.image), ...base }];
        }
        const untouched =
          current.placedSignatures.length + current.texts.length + current.shapes.length + current.images.length === 0 &&
          current.redactions.length + current.comments.length + current.highlights.length === 0;
        placed.file = restored.file;
        placed.originalFile = restored.file;
        placed.exported = current.exported || untouched;
        return { ...state, documents: state.documents.map((d) => (d.id === id ? placed : d)) };
      });
      if (applied) clearHistory(id);
    } catch {
      // Unreadable or locked: the items stay drawn on the pages, as any reader shows them.
    }
  }

  /** Replaces the whole document list, e.g. the initial upload. */
  function loadPdfs(files: File[]) {
    history.clearAll();
    const documents = files.map(createDocumentState);
    set({
      documents,
      activeId: documents[0]?.id ?? null,
      renderScale: DEFAULT_RENDER_SCALE,
      hasExported: false,
    });
    documents.forEach(resolvePageCount);
    documents.forEach((d) => restorePlacedItems(d.id));
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
    added.forEach((d) => restorePlacedItems(d.id));
  }

  /**
   * Swaps a password-protected document for its unlocked copy (see
   * lib/pdf/password.ts). Nothing can be placed on a locked document, so it
   * becomes the file "as uploaded" and there's no history to keep.
   */
  function unlockDocument(id: string, file: File) {
    clearHistory(id);
    update((state) => ({
      ...state,
      documents: state.documents.map((doc) => (doc.id === id ? { ...doc, file, originalFile: file } : doc)),
    }));
    const doc = currentState().documents.find((d) => d.id === id);
    if (doc) {
      resolvePageCount(doc);
      restorePlacedItems(id);
    }
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

  /**
   * Merges documents into one, in the given order, which takes the first one's
   * place in the tabs and replaces them all. Everything placed on their pages
   * comes along and stays editable; the first document with page numbers, a
   * header and footer, or a page watermark gives them to the whole result.
   * Returns the merged document's id.
   */
  async function mergeDocuments(ids: string[]): Promise<string | null> {
    const before = ids
      .map((id) => currentState().documents.find((d) => d.id === id))
      .filter((d): d is PdfDocumentState => !!d);
    if (before.length < 2) return null;

    const base = before[0].file.name.replace(/\.pdf$/i, '');
    const { file, pageCounts } = await (await pageOps()).mergePdfFiles(
      before.map((d) => ({ file: d.file, rotation: d.rotation })),
      `${base}_merged.pdf`,
    );

    // Read again, for anything placed while the files were being joined.
    const docs = before.map((d) => currentState().documents.find((c) => c.id === d.id));
    if (docs.some((d, i) => !d || d.file !== before[i].file || d.rotation !== before[i].rotation)) {
      throw new Error('A document changed while merging. Please try again.');
    }

    const merged = createDocumentState(file);
    // The joined file exists only here until it's saved, so it counts as an
    // edit: closing the tab asks first, and it can be saved with nothing placed.
    merged.originalFile = docs[0]!.originalFile;
    merged.pageCount = pageCounts.reduce((a, b) => a + b, 0);
    let offset = 0;
    for (const [i, doc] of (docs as PdfDocumentState[]).entries()) {
      const shift = offset;
      const items = await mapPageItems(doc, async (list) => list.map((item) => ({ ...item, page: item.page + shift })));
      merged.placedSignatures.push(...items.placedSignatures);
      merged.redactions.push(...items.redactions);
      merged.texts.push(...items.texts);
      merged.comments.push(...items.comments);
      merged.highlights.push(...items.highlights);
      merged.shapes.push(...items.shapes);
      merged.images.push(...items.images);
      merged.formValues = { ...doc.formValues, ...merged.formValues };
      merged.pageNumbers ??= doc.pageNumbers;
      merged.headerFooter ??= doc.headerFooter;
      merged.pageWatermark ??= doc.pageWatermark;
      offset += pageCounts[i];
    }

    const removed = new Set(ids);
    removed.forEach(clearHistory);
    update((state) => {
      const at = state.documents.findIndex((d) => removed.has(d.id));
      const documents = state.documents.filter((d) => !removed.has(d.id));
      documents.splice(Math.min(at, documents.length), 0, merged);
      return { ...state, documents, activeId: merged.id };
    });
    return merged.id;
  }

  /** Moves a document's tab to position `toIndex` (0-based) in the tab order. */
  function moveDocument(id: string, toIndex: number) {
    update((state) => {
      const from = state.documents.findIndex((d) => d.id === id);
      const to = clamp(toIndex, 0, state.documents.length - 1);
      if (from === -1 || from === to) return state;
      const documents = [...state.documents];
      const [moved] = documents.splice(from, 1);
      documents.splice(to, 0, moved);
      return { ...state, documents };
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

  function withPageCount(doc: PdfDocumentState, count: number): PdfDocumentState {
    const pageCount = Math.max(1, count);
    return { ...doc, pageCount, pageNumber: clamp(doc.pageNumber, 1, pageCount) };
  }

  function setPageCount(count: number) {
    update((state) => updateActiveDocument(state, (doc) => withPageCount(doc, count)));
  }

  /** Sets the page count on an arbitrary document, not just the active one. */
  function setPageCountForDocument(id: string, count: number) {
    update((state) => ({
      ...state,
      documents: state.documents.map((doc) => (doc.id === id ? withPageCount(doc, count) : doc)),
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

  // Signatures, redactions, text boxes, comments, shapes, and images share
  // these: each add, change, or removal is an undo step, and changes to one
  // item (a drag, a slider) coalesce into one.

  type ListName = keyof PageItems;
  type ItemOf<K extends ListName> = PdfDocumentState[K][number];

  /** Changes one of the active document's item lists as an undo step identified by `actionKey`. */
  function editActiveList<K extends ListName>(key: K, actionKey: string, fn: (items: PdfDocumentState[K]) => PageItem[]) {
    recordActiveHistory(actionKey);
    update((state) => updateActiveDocument(state, (doc) => ({ ...doc, [key]: fn(doc[key]), exported: false })));
  }

  function addItem<K extends ListName>(key: K, item: Omit<ItemOf<K>, 'id'>): string {
    const id = crypto.randomUUID();
    editActiveList(key, `add-${key}-${id}`, (items) => [...(items as PageItem[]), { ...item, id } as PageItem]);
    return id;
  }

  function updateItem<K extends ListName>(key: K, id: string, partial: Partial<ItemOf<K>>) {
    editActiveList(key, `update-${key}-${id}`, (items) =>
      (items as PageItem[]).map((item) => (item.id === id ? { ...item, ...partial } : item)),
    );
  }

  function removeItem<K extends ListName>(key: K, id: string) {
    editActiveList(key, `remove-${key}-${id}-${Date.now()}`, (items) =>
      (items as PageItem[]).filter((item) => item.id !== id),
    );
  }

  /** Copies of `items` with fresh ids. */
  function withIds<T extends object>(items: T[]): (T & { id: string })[] {
    return items.map((item) => ({ ...item, id: crypto.randomUUID() }));
  }

  /**
   * Replaces one item list of any document (not just the active one) with
   * copies of `items`, outside its undo history. Used by "Apply to All" to
   * make every other document match the active one.
   */
  function setListForDocument<K extends ListName>(docId: string, key: K, items: Omit<ItemOf<K>, 'id'>[]) {
    update((state) => ({
      ...state,
      documents: state.documents.map((doc) =>
        doc.id === docId ? { ...doc, [key]: withIds(items), exported: false } : doc,
      ),
    }));
  }

  const addSignature = (placement: Omit<PlacedSignature, 'id'>) => addItem('placedSignatures', placement);
  const updateSignature = (id: string, partial: Partial<PlacedSignature>) => updateItem('placedSignatures', id, partial);
  const removeSignature = (id: string) => removeItem('placedSignatures', id);
  const setSignaturesForDocument = (id: string, placements: Omit<PlacedSignature, 'id'>[]) =>
    setListForDocument(id, 'placedSignatures', placements);

  /**
   * Replaces the active document's entire signature set: "Apply Signature to
   * All Pages" replicates one page's placement(s) across every page. Unlike
   * setSignaturesForDocument, this is a same-document edit and goes through
   * the active document's own undo history like any other placement change.
   */
  function applySignaturesToAllPages(placements: Omit<PlacedSignature, 'id'>[]) {
    editActiveList('placedSignatures', `apply-signature-all-pages-${crypto.randomUUID()}`, () => withIds(placements));
  }

  const addRedaction = (box: Omit<RedactionBox, 'id'>) => addItem('redactions', box);
  const updateRedaction = (id: string, partial: Partial<RedactionBox>) => updateItem('redactions', id, partial);
  const removeRedaction = (id: string) => removeItem('redactions', id);
  const setRedactionsForDocument = (id: string, boxes: Omit<RedactionBox, 'id'>[]) =>
    setListForDocument(id, 'redactions', boxes);

  /** Adds several boxes to the active document as one undo step (e.g. copying a box to every page). */
  function addRedactions(boxes: Omit<RedactionBox, 'id'>[]) {
    if (boxes.length === 0) return;
    editActiveList('redactions', `add-redactions-${crypto.randomUUID()}`, (items) => [...items, ...withIds(boxes)]);
  }

  /** Removes every box on one page of the active document, as one undo step. */
  function removeRedactionsOnPage(page: number) {
    editActiveList('redactions', `remove-page-redactions-${page}-${Date.now()}`, (items) =>
      items.filter((box) => box.page !== page),
    );
  }

  /** Removes every box in the active document, as one undo step. */
  function removeAllRedactions() {
    editActiveList('redactions', `remove-all-redactions-${Date.now()}`, () => []);
  }

  const addText = (text: Omit<PlacedText, 'id'>) => addItem('texts', text);
  const updateText = (id: string, partial: Partial<PlacedText>) => updateItem('texts', id, partial);
  const removeText = (id: string) => removeItem('texts', id);
  const setTextsForDocument = (id: string, items: Omit<PlacedText, 'id'>[]) => setListForDocument(id, 'texts', items);

  const addComment = (comment: Omit<PlacedComment, 'id'>) => addItem('comments', comment);
  const updateComment = (id: string, partial: Partial<PlacedComment>) => updateItem('comments', id, partial);
  const removeComment = (id: string) => removeItem('comments', id);
  const setCommentsForDocument = (id: string, items: Omit<PlacedComment, 'id'>[]) =>
    setListForDocument(id, 'comments', items);

  const addShape = (shape: Omit<PlacedShape, 'id'>) => addItem('shapes', shape);
  const updateShape = (id: string, partial: Partial<PlacedShape>) => updateItem('shapes', id, partial);
  const removeShape = (id: string) => removeItem('shapes', id);

  const addImage = (image: Omit<PlacedImage, 'id'>) => addItem('images', image);
  const updateImage = (id: string, partial: Partial<PlacedImage>) => updateItem('images', id, partial);
  const removeImage = (id: string) => removeItem('images', id);

  /**
   * Marks up a text selection on the active document — one rectangle per
   * line, removed together. With `note`, an empty comment marker attached to
   * the markup is added in the same step; its id is returned.
   */
  function addHighlight(
    page: number,
    rects: Geometry[],
    kind: MarkupKind,
    color: string,
    note?: Geometry,
  ): string | undefined {
    if (rects.length === 0) return;
    const groupId = crypto.randomUUID();
    const commentId = note ? crypto.randomUUID() : undefined;
    recordActiveHistory(`add-highlight-${groupId}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        highlights: [
          ...doc.highlights,
          ...rects.map((r) => ({ ...r, page, groupId, kind, color, id: crypto.randomUUID() })),
        ],
        comments:
          note && commentId ? [...doc.comments, { ...note, page, text: '', groupId, id: commentId }] : doc.comments,
        exported: false,
      })),
    );
    return commentId;
  }

  /**
   * Several markups at once (Find's Highlight all), as one undo step. A mark
   * whose first box is already highlighted on that page is skipped, so
   * running it twice doesn't stack highlights. Returns how many were added.
   */
  function addHighlights(marks: { page: number; rects: Geometry[] }[], kind: MarkupKind, color: string): number {
    const highlights = getActiveDocument(currentState())?.highlights;
    if (!highlights) return 0;
    const near = (a: Geometry, b: Geometry) =>
      Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.width - b.width) < 1;
    const fresh = marks.filter(
      (m) =>
        m.rects.length > 0 &&
        !highlights.some((h) => h.page === m.page && h.kind === kind && near(h, m.rects[0])),
    );
    if (fresh.length === 0) return 0;
    recordActiveHistory(`add-highlights-${crypto.randomUUID()}`);
    update((state) =>
      updateActiveDocument(state, (d) => ({
        ...d,
        highlights: [
          ...d.highlights,
          ...fresh.flatMap((m) => {
            const groupId = crypto.randomUUID();
            return m.rects.map((r) => ({ ...r, page: m.page, groupId, kind, color, id: crypto.randomUUID() }));
          }),
        ],
        exported: false,
      })),
    );
    return fresh.length;
  }

  /** Changes the color of every rectangle of one markup. */
  function recolorHighlight(groupId: string, color: string) {
    recordActiveHistory(`recolor-highlight-${groupId}-${Date.now()}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        highlights: doc.highlights.map((h) => (h.groupId === groupId ? { ...h, color } : h)),
        exported: false,
      })),
    );
  }

  function removeHighlight(groupId: string) {
    recordActiveHistory(`remove-highlight-${groupId}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        highlights: doc.highlights.filter((h) => h.groupId !== groupId),
        comments: doc.comments.filter((c) => c.groupId !== groupId),
        exported: false,
      })),
    );
  }


  /**
   * Moves several items at once (aligning, distributing, dragging a group),
   * one undo step. Calls with the same `actionKey` coalesce like a drag.
   */
  function moveItems(moves: (ItemRef & { x: number; y: number })[], actionKey = `move-items-${crypto.randomUUID()}`) {
    if (moves.length === 0) return;
    recordActiveHistory(actionKey);
    update((state) =>
      updateActiveDocument(state, (doc) => {
        const next = { ...doc, exported: false };
        for (const kind of ITEM_KINDS) {
          const key = ITEM_LISTS[kind];
          const forKind = new Map(moves.filter((m) => m.kind === kind).map((m) => [m.id, m]));
          if (forKind.size === 0) continue;
          (next[key] as PageItem[]) = (doc[key] as PageItem[]).map((item) => {
            const m = forKind.get(item.id);
            return m ? { ...item, x: m.x, y: m.y } : item;
          });
        }
        return next;
      }),
    );
  }

  /**
   * Copies items, shifted by (dx, dy), as one undo step. Returns the copies,
   * in the order given.
   */
  function duplicateItems(refs: ItemRef[], dx: number, dy: number): ItemRef[] {
    const doc = getActiveDocument(currentState());
    if (!doc || refs.length === 0) return [];
    const copies: ItemRef[] = [];
    const added: Partial<Record<ItemKind, PageItem[]>> = {};
    for (const ref of refs) {
      const item = (doc[ITEM_LISTS[ref.kind]] as PageItem[]).find((i) => i.id === ref.id);
      if (!item) continue;
      const id = crypto.randomUUID();
      (added[ref.kind] ??= []).push({ ...item, id, x: item.x + dx, y: item.y + dy });
      copies.push({ kind: ref.kind, id });
    }
    if (copies.length === 0) return [];
    recordActiveHistory(`duplicate-items-${crypto.randomUUID()}`);
    update((state) =>
      updateActiveDocument(state, (d) => {
        const next = { ...d, exported: false };
        for (const kind of ITEM_KINDS) {
          const extra = added[kind];
          if (extra) (next[ITEM_LISTS[kind]] as PageItem[]) = [...(d[ITEM_LISTS[kind]] as PageItem[]), ...extra];
        }
        return next;
      }),
    );
    return copies;
  }

  /** Removes several items at once, one undo step. */
  function removeItems(refs: ItemRef[]) {
    if (refs.length === 0) return;
    recordActiveHistory(`remove-items-${crypto.randomUUID()}`);
    update((state) =>
      updateActiveDocument(state, (doc) => {
        const next = { ...doc, exported: false };
        for (const kind of ITEM_KINDS) {
          const ids = new Set(refs.filter((r) => r.kind === kind).map((r) => r.id));
          if (ids.size === 0) continue;
          (next[ITEM_LISTS[kind]] as PageItem[]) = (doc[ITEM_LISTS[kind]] as PageItem[]).filter((i) => !ids.has(i.id));
        }
        return next;
      }),
    );
  }

  /** Records a value typed or picked into one of the PDF's own form fields. */
  function setFormValue(fieldName: string, value: string | boolean) {
    recordActiveHistory(`form-${fieldName}`);
    update((state) =>
      updateActiveDocument(state, (doc) => ({
        ...doc,
        formValues: { ...doc.formValues, [fieldName]: value },
        exported: false,
      })),
    );
  }

  /** Turns page numbers on (with these settings) or off (null) for the active document. */
  function setPageNumbers(settings: PageNumberSettings | null) {
    recordActiveHistory('page-numbers');
    update((state) =>
      updateActiveDocument(state, (doc) => ({ ...doc, pageNumbers: settings, exported: false })),
    );
  }

  /** Sets the header and footer text (with its style) for the active document, or removes it (null). */
  function setHeaderFooter(settings: HeaderFooterSettings | null) {
    recordActiveHistory('header-footer');
    update((state) =>
      updateActiveDocument(state, (doc) => ({ ...doc, headerFooter: settings, exported: false })),
    );
  }

  /** Sets the watermark stamped across the active document's pages, or removes it (null). */
  function setPageWatermark(settings: PageWatermarkSettings | null) {
    recordActiveHistory('page-watermark');
    update((state) =>
      updateActiveDocument(state, (doc) => ({ ...doc, pageWatermark: settings, exported: false })),
    );
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

    const { id, file, rotation: oldRotation } = doc;
    const { renderScale } = state;
    const newRotation = (((oldRotation + delta) % 360) + 360) % 360;

    recordHistory(id, `rotate-${crypto.randomUUID()}`, doc);

    const applyRotation = (items: PageItems) => {
      update((state) => ({
        ...state,
        // Target this specific document rather than "whichever is active
        // now" — the pdf.js work below is async, so the user could have
        // switched tabs before it resolves.
        documents: state.documents.map((d) =>
          d.id === id ? { ...d, ...items, rotation: newRotation, exported: false } : d,
        ),
      }));
    };

    try {
      const pdfjsDoc = await getCachedPdf(id, file);
      const rotate = <T extends PageItem>(items: T[]) =>
        Promise.all(items.map((item) => rotateGeometry(pdfjsDoc, item.page, renderScale, oldRotation, newRotation, item)));
      applyRotation(await mapPageItems(doc, rotate));
    } catch {
      // Couldn't re-derive the geometry (e.g. the PDF failed to load) — fall
      // back to clearing rather than leaving stale, now-misaligned positions.
      applyRotation(await mapPageItems(doc, async () => []));
    }
  }

  /**
   * Applies a page-level edit to the active document. The PDF file itself is
   * rewritten, so rendering, thumbnails, and export all keep working on plain
   * page numbers; every placement/redaction/text/comment follows its page (or
   * is dropped with it), and the old file stays in the undo history. Edits
   * the document `docId` instead, if given.
   */
  async function editPages(edit: PageEdit, docId?: string) {
    const doc = docId
      ? currentState().documents.find((d) => d.id === docId)
      : getActiveDocument(currentState());
    if (!doc) return;
    const { renderScale } = currentState();

    const reshaped = new Set(edit.reshapesPages ?? []);
    const oldPdf = reshaped.size > 0 ? await getCachedPdf(doc.id, doc.file) : null;
    const file = await edit.rewrite(doc.file);
    // Parsed up front (and cached for the viewer), so the new page count is
    // known the moment the file is swapped in.
    const newPdf = await getCachedPdf(doc.id, file);
    const pageCount = newPdf.numPages;

    const remap = async <T extends PageItem>(items: T[]): Promise<T[]> => {
      const result: T[] = [];
      for (const item of items) {
        const page = edit.mapPage(item.page);
        if (page === null) continue;
        let moved: T = { ...item, page };
        if (oldPdf && reshaped.has(item.page)) {
          moved = await convertGeometry(
            { pdfjsDoc: oldPdf, pageNumber: item.page, rotation: doc.rotation },
            { pdfjsDoc: newPdf, pageNumber: page, rotation: doc.rotation },
            renderScale,
            moved,
          );
        }
        result.push(moved);
        if (item.page === edit.copiesPage) result.push({ ...moved, id: crypto.randomUUID(), page: page + 1 });
      }
      return result;
    };

    // A duplicated page's highlights get their own group, so removing one
    // copy's highlight leaves the other's alone. The copy's notes follow
    // their markup's new group.
    const regroupCopies = (items: PageItems): void => {
      if (edit.copiesPage === undefined) return;
      const copyPage = edit.mapPage(edit.copiesPage);
      if (copyPage === null) return;
      const newGroups = new Map<string, string>();
      items.highlights = items.highlights.map((h) => {
        if (h.page !== copyPage + 1) return h;
        let groupId = newGroups.get(h.groupId);
        if (!groupId) {
          groupId = crypto.randomUUID();
          newGroups.set(h.groupId, groupId);
        }
        return { ...h, groupId };
      });
      items.comments = items.comments.map((c) =>
        c.page === copyPage + 1 && c.groupId && newGroups.has(c.groupId) ? { ...c, groupId: newGroups.get(c.groupId) } : c,
      );
    };

    // The rewrite is async — work from the document as it is now (the user
    // may have moved something meanwhile), and bail if another page edit (or
    // undo) already replaced the file.
    const findLatest = () => currentState().documents.find((d) => d.id === doc.id);
    const current = findLatest();
    if (!current || current.file !== doc.file) return;

    const items = await mapPageItems(current, remap);
    regroupCopies(items);

    const latest = findLatest();
    if (!latest || latest.file !== doc.file) return;

    recordHistory(latest.id, `edit-pages-${crypto.randomUUID()}`, latest);
    update((state) => ({
      ...state,
      documents: state.documents.map((d) =>
        d.id === latest.id
          ? {
              ...d,
              ...items,
              file,
              pageCount,
              pageNumber: clamp(edit.mapCurrent(d.pageNumber, pageCount), 1, pageCount),
              exported: false,
            }
          : d,
      ),
    }));
  }

  /** Moves page `from` to position `to` (both 1-indexed); the page being viewed stays on screen. */
  function movePage(from: number, to: number) {
    const doc = getActiveDocument(currentState());
    if (!doc || from === to || from < 1 || to < 1 || from > doc.pageCount || to > doc.pageCount) {
      return Promise.resolve();
    }

    const order = Array.from({ length: doc.pageCount }, (_, i) => i + 1);
    const [moved] = order.splice(from - 1, 1);
    order.splice(to - 1, 0, moved);
    const newPageOf = new Map(order.map((original, i) => [original, i + 1]));
    const mapPage = (page: number) => newPageOf.get(page) ?? page;

    return editPages({ rewrite: async (file) => (await pageOps()).movePdfPage(file, from, to), mapPage, mapCurrent: mapPage });
  }

  /** Deletes pages (1-indexed) along with everything placed on them, as one undo step. */
  function deletePages(pages: number[]) {
    const removed = new Set(pages);
    const removedBefore = (p: number) => pages.filter((d) => d < p).length;
    return editPages({
      rewrite: async (file) => (await pageOps()).deletePdfPages(file, pages),
      mapPage: (p) => (removed.has(p) ? null : p - removedBefore(p)),
      // A deleted current page gives way to the nearest page before it (or the first one left).
      mapCurrent: (p) => p - removedBefore(p) - (removed.has(p) ? 1 : 0),
    });
  }

  function deletePage(page: number) {
    return deletePages([page]);
  }

  /** Inserts a copy of a page (1-indexed), with everything placed on it, right after it — and shows the copy. */
  function duplicatePage(page: number) {
    return editPages({
      rewrite: async (file) => (await pageOps()).duplicatePdfPage(file, page),
      mapPage: (p) => (p > page ? p + 1 : p),
      mapCurrent: () => page + 1,
      copiesPage: page,
    });
  }

  /** Inserts a blank page after page `after` (1-indexed) and shows it. */
  function insertBlankPage(after: number) {
    return editPages({
      rewrite: async (file) => (await pageOps()).insertBlankPdfPage(file, after),
      mapPage: (p) => (p > after ? p + 1 : p),
      mapCurrent: () => after + 1,
    });
  }

  /**
   * Rotates pages (1-indexed) by `delta` degrees, saved into the file —
   * unlike rotateLeft/rotateRight, which turn the whole document.
   */
  function rotatePages(pages: number[], delta: number) {
    return editPages({
      rewrite: async (file) => (await pageOps()).rotatePdfPages(file, pages, delta),
      mapPage: (p) => p,
      mapCurrent: (p) => p,
      reshapesPages: pages,
    });
  }

  function rotatePage(page: number, delta: number) {
    return rotatePages([page], delta);
  }

  /**
   * Crops pages (1-indexed) to `area`, given as fractions (0 to 1) of each
   * page as it's shown, rotation included, so one frame fits pages of any
   * size. Saved into the file; everything placed on the pages stays over
   * the same content.
   */
  async function cropPages(pages: number[], area: Geometry) {
    const doc = getActiveDocument(currentState());
    if (!doc || pages.length === 0) return;
    const pdf = await getCachedPdf(doc.id, doc.file);
    const crops = await Promise.all(
      pages.map(async (page) => {
        const pdfPage = await pdf.getPage(page);
        const viewport = pdfPage.getViewport({ scale: 1, rotation: getTotalRotation(pdfPage, doc.rotation) });
        const [x1, y1] = viewport.convertToPdfPoint(area.x * viewport.width, area.y * viewport.height);
        const [x2, y2] = viewport.convertToPdfPoint(
          (area.x + area.width) * viewport.width,
          (area.y + area.height) * viewport.height,
        );
        return {
          page,
          area: { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) },
        };
      }),
    );
    return editPages({
      rewrite: async (file) => (await pageOps()).cropPdfPages(file, crops),
      mapPage: (p) => p,
      mapCurrent: (p) => p,
      reshapesPages: pages,
    });
  }

  /** Shows the whole of pages (1-indexed) again, undoing any crop (the file's own included). */
  function uncropPages(pages: number[]) {
    return editPages({
      rewrite: async (file) => (await pageOps()).uncropPdfPages(file, pages),
      mapPage: (p) => p,
      mapCurrent: (p) => p,
      reshapesPages: pages,
    });
  }

  /**
   * Writes recognized text (lib/pdf/ocr.ts) into a document's pages, as one
   * undo step. Recognition takes a while, so it's only applied if the file
   * is still `basedOn`, the one recognized; resolves to whether it was.
   */
  async function addRecognizedText(docId: string, basedOn: File, pages: OcrPage[]): Promise<boolean> {
    const doc = currentState().documents.find((d) => d.id === docId);
    if (!doc || doc.file !== basedOn) return false;
    await editPages(
      { rewrite: async (file) => (await pageOps()).addInvisibleText(file, pages), mapPage: (p) => p, mapCurrent: (p) => p },
      docId,
    );
    const latest = currentState().documents.find((d) => d.id === docId);
    return !!latest && latest.file !== basedOn;
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
    history.clearAll();
    set({ documents: [], activeId: null, renderScale: DEFAULT_RENDER_SCALE, hasExported: false });
  }

  /** Steps the active document back (`undo`) or forward through its history. */
  function stepHistory(direction: 'undo' | 'redo') {
    const doc = getActiveDocument(currentState());
    if (!doc) return;
    const restored = history.step(doc, direction);
    if (!restored) return;
    update((state) => ({ ...state, documents: state.documents.map((d) => (d.id === doc.id ? restored : d)) }));
  }

  const undo = () => stepHistory('undo');
  const redo = () => stepHistory('redo');

  return {
    subscribe,
    historyTick: history.tick,
    getHistory: history.get,
    loadPdfs,
    addPdfs,
    unlockDocument,
    removeDocument,
    mergeDocuments,
    moveDocument,
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
    addRedactions,
    removeRedactionsOnPage,
    removeAllRedactions,
    setRedactionsForDocument,
    addText,
    updateText,
    removeText,
    setTextsForDocument,
    addComment,
    updateComment,
    removeComment,
    setCommentsForDocument,
    addHighlight,
    addHighlights,
    recolorHighlight,
    removeHighlight,
    addShape,
    updateShape,
    removeShape,
    addImage,
    updateImage,
    removeImage,
    moveItems,
    duplicateItems,
    removeItems,
    setFormValue,
    setPageNumbers,
    setHeaderFooter,
    setPageWatermark,
    markDocumentExported,
    setRenderScale,
    zoomIn,
    zoomOut,
    resetZoom,
    rotateLeft,
    rotateRight,
    movePage,
    deletePage,
    deletePages,
    duplicatePage,
    insertBlankPage,
    rotatePage,
    rotatePages,
    cropPages,
    uncropPages,
    addRecognizedText,
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
