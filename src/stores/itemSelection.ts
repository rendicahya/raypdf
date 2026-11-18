import { get, writable } from 'svelte/store';
import { activeDocument, editorStore, ITEM_LISTS, type ItemKind, type ItemRef } from './editor';
import {
  alignOffsets,
  distributeOffsets,
  unionBounds,
  visualBounds,
  type Alignment,
  type ArrangeItem,
  type Axis,
  type Bounds,
} from '../lib/utils/arrange';

type PageSize = { width: number; height: number };

/**
 * Several placed items selected together (Shift- or Ctrl-click), on one page
 * of one document, to align, distribute, move, duplicate, or delete as a
 * group. Separate from each kind's own single selection; ItemSelection draws
 * it and handles its gestures.
 */
export interface ItemSelection {
  docId: string;
  page: number;
  items: ItemRef[];
}

export const itemSelection = writable<ItemSelection | null>(null);

export function clearItemSelection() {
  itemSelection.set(null);
}

/** The data attribute each selectable kind's element carries its id in. */
export const ITEM_ATTRS: Record<ItemKind, string> = {
  signature: 'data-placed-signature',
  text: 'data-placed-text',
  shape: 'data-placed-shape',
  image: 'data-placed-image',
};

export const ITEM_SELECTOR = Object.values(ITEM_ATTRS)
  .map((attr) => `[${attr}]`)
  .join(',');

/** The selectable item an element belongs to, if any. */
export function itemRefOf(target: EventTarget | null): ItemRef | null {
  const el = (target as Element | null)?.closest?.(ITEM_SELECTOR);
  if (!el) return null;
  for (const [kind, attr] of Object.entries(ITEM_ATTRS) as [ItemKind, string][]) {
    const id = el.getAttribute(attr);
    if (id) return { kind, id };
  }
  return null;
}

/** A Shift-, Ctrl-, or Cmd-click on a placed item: adds it to or removes it from the selection. */
export function isMultiSelectClick(e: PointerEvent | MouseEvent): boolean {
  if (!(e.shiftKey || e.ctrlKey || e.metaKey)) return false;
  const target = e.target as Element | null;
  if (target?.closest?.('textarea, input, select')) return false;
  return !!itemRefOf(target);
}

export function sameItem(a: ItemRef, b: ItemRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export type ResolvedItem = ItemRef & ArrangeItem;

/** The items of the active document these refs point to, skipping any since removed. */
export function resolveItems(refs: ItemRef[]): ResolvedItem[] {
  const doc = get(activeDocument);
  if (!doc) return [];
  return refs.flatMap((ref) => {
    const item = (doc[ITEM_LISTS[ref.kind]] as (ArrangeItem & { id: string })[]).find((i) => i.id === ref.id);
    return item ? [{ ...item, kind: ref.kind, id: ref.id }] : [];
  });
}

/** The selection's items, if it's on the active document. */
function selectedItems(): ResolvedItem[] {
  const sel = get(itemSelection);
  const doc = get(activeDocument);
  if (!sel || !doc || sel.docId !== doc.id) return [];
  return resolveItems(sel.items);
}

function applyOffsets(items: ResolvedItem[], offsets: { dx: number; dy: number }[], actionKey?: string) {
  const moves = items
    .map((item, i) => ({ kind: item.kind, id: item.id, x: item.x + offsets[i].dx, y: item.y + offsets[i].dy }))
    .filter((_, i) => offsets[i].dx !== 0 || offsets[i].dy !== 0);
  editorStore.moveItems(moves, actionKey);
}

/** Lines the selected items up with each other, or one item with the page. */
export function alignSelection(edge: Alignment, page: PageSize) {
  const items = selectedItems();
  if (items.length === 0) return;
  const target: Bounds =
    items.length === 1
      ? { left: 0, top: 0, right: page.width, bottom: page.height }
      : unionBounds(items.map(visualBounds));
  applyOffsets(items, alignOffsets(items, edge, target));
}

export function distributeSelection(axis: Axis) {
  const items = selectedItems();
  if (items.length < 3) return;
  applyOffsets(items, distributeOffsets(items, axis));
}

/**
 * Moves the selection by (dx, dy), as far as the page allows, keeping the
 * items' places relative to each other.
 */
export function moveSelectionBy(dx: number, dy: number, page: PageSize, actionKey?: string, from?: ResolvedItem[]) {
  const items = from ?? selectedItems();
  if (items.length === 0) return;
  const b = unionBounds(items.map(visualBounds));
  const cx = Math.min(Math.max(dx, Math.min(0, -b.left)), Math.max(0, page.width - b.right));
  const cy = Math.min(Math.max(dy, Math.min(0, -b.top)), Math.max(0, page.height - b.bottom));
  applyOffsets(
    items,
    items.map(() => ({ dx: cx, dy: cy })),
    actionKey,
  );
}

/**
 * Copies items a little down and to the right of the originals (up or left
 * where that would run off the page), one undo step. Returns the copies.
 */
export function duplicateItemsOnPage(refs: ItemRef[], page: PageSize): ItemRef[] {
  const items = resolveItems(refs);
  if (items.length === 0) return [];
  const step = 8 * get(editorStore).renderScale;
  const b = unionBounds(items.map(visualBounds));
  const dx = b.right + step <= page.width ? step : b.left - step >= 0 ? -step : 0;
  const dy = b.bottom + step <= page.height ? step : b.top - step >= 0 ? -step : 0;
  return editorStore.duplicateItems(items, dx || step, dy || step);
}

/** Duplicates the selection; the copies become the selection. */
export function duplicateSelection(page: PageSize) {
  const sel = get(itemSelection);
  const items = selectedItems();
  if (!sel || items.length === 0) return;
  const copies = duplicateItemsOnPage(items, page);
  if (copies.length > 0) itemSelection.set({ ...sel, items: copies });
}

export function deleteSelection() {
  editorStore.removeItems(selectedItems());
  clearItemSelection();
}
