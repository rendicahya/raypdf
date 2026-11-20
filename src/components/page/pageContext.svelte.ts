import { getContext, setContext } from 'svelte';
import type { CommentEditing } from './commentEditing.svelte';
import type { TextEditing } from './textEditing.svelte';

/**
 * What one page has selected on its own, shared by PDFViewer and the layers
 * it's built from (components/page/). Each page has its own, so selecting
 * something on one page never touches another. Text boxes and shapes keep
 * theirs in stores (`selectedTextId`, `selectedShapeId`), since the tool
 * panel restyles them; a group selection is `itemSelection`.
 */
export class PageSelection {
  signatureId: string | null = $state(null);
  redactionId: string | null = $state(null);
  imageId: string | null = $state(null);
  /** The markup (all its boxes share a group) whose options bar is showing. */
  highlightGroup: string | null = $state(null);
  commentId: string | null = $state(null);
  /** The comment whose note is open for typing. */
  editingCommentId: string | null = $state(null);
  /** The text box open for typing (its selection is `selectedTextId`). */
  editingTextId: string | null = $state(null);
}

export interface PageContext {
  selection: PageSelection;
  /** The comment note being typed on this page. */
  commentEditing: CommentEditing;
  /** The text box being typed in on this page. */
  textEditing: TextEditing;
  /** The page canvas's box on screen: item coordinates are relative to its top-left corner. */
  canvasRect(): DOMRect;
}

const KEY = Symbol('page');

/** Called once by PDFViewer, for its layers. */
export function setPageContext(context: PageContext): void {
  setContext(KEY, context);
}

export function getPageContext(): PageContext {
  return getContext<PageContext>(KEY);
}
