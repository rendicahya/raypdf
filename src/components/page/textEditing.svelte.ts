import { editorStore } from '../../stores/editor';
import { selectedTextId } from '../../stores/textTool';
import type { PageSelection } from './pageContext.svelte';

/**
 * Typing into a text box, for one page: opened by the Add Text tool, a
 * double-click, or the box's menu; written back when the textarea closes.
 * A box left empty is dropped rather than left as an invisible placeholder.
 */
export class TextEditing {
  /** The text as typed so far. */
  value = $state('');
  #selection: PageSelection;

  constructor(selection: PageSelection) {
    this.#selection = selection;
  }

  /** Selects a text box and opens it for typing. */
  start(id: string, initialValue: string): void {
    selectedTextId.set(id);
    this.#selection.editingTextId = id;
    this.value = initialValue;
  }

  /**
   * Closes the box being typed in and saves it. `forId`, when given, is the
   * box the caller believes it's committing (a textarea's own blur). When a
   * box stops being edited, Svelte unmounts its textarea, which fires a real
   * blur, by which time the editing may have moved on to a new box the user
   * clicked to create; without the guard that stale blur would close the new
   * box instead.
   */
  commit(forId?: string): void {
    const id = this.#selection.editingTextId;
    if (!id || (forId !== undefined && forId !== id)) return;
    const value = this.value;
    this.#selection.editingTextId = null;
    if (!value.trim()) editorStore.removeText(id);
    else editorStore.updateText(id, { text: value });
  }
}
