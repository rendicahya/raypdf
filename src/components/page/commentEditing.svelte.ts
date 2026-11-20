import { get } from 'svelte/store';
import { activeDocument, editorStore } from '../../stores/editor';
import type { PageSelection } from './pageContext.svelte';

/**
 * Typing a comment's note, for one page: opened by the Comment tool, the
 * selection toolbar's Comment, a markup's options bar, a double-click on a
 * marker, or its menu; written back when it closes. An empty note is
 * dropped rather than left as a blank marker, and a comment just added to
 * selected text takes its highlight with it, since both came from the same
 * button.
 */
export class CommentEditing {
  /** The note as typed so far. */
  value = $state('');
  #newOnText: string | null = null;
  #selection: PageSelection;
  #removeMarkup: (groupId: string) => void;

  constructor(selection: PageSelection, removeMarkup: (groupId: string) => void) {
    this.#selection = selection;
    this.#removeMarkup = removeMarkup;
  }

  /** Selects a comment and opens its note. `newOnText`: it was just added with a highlight of selected text. */
  start(id: string, initialValue: string, newOnText = false): void {
    this.#selection.commentId = id;
    this.#selection.editingCommentId = id;
    this.value = initialValue;
    if (newOnText) this.#newOnText = id;
  }

  /**
   * Closes the note being typed and saves it. `forId` guards against a stale
   * blur firing after the editing has already moved on to another marker.
   */
  commit(forId?: string): void {
    const selection = this.#selection;
    const id = selection.editingCommentId;
    if (!id || (forId !== undefined && forId !== id)) return;
    const value = this.value;
    selection.editingCommentId = null;
    const isNewOnText = this.#newOnText === id;
    this.#newOnText = null;
    if (!value.trim()) {
      const groupId = get(activeDocument)?.comments.find((c) => c.id === id)?.groupId;
      if (isNewOnText && groupId) this.#removeMarkup(groupId);
      else editorStore.removeComment(id);
      if (selection.commentId === id) selection.commentId = null;
    } else {
      editorStore.updateComment(id, { text: value });
    }
  }
}
