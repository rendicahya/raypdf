import { writable } from 'svelte/store';
import type { SearchMatch } from '../lib/pdf/search';

export interface SearchState {
  open: boolean;
  query: string;
  /** Matches in the active document for `query`, in reading order. */
  matches: SearchMatch[];
  /** Index into `matches` of the one shown, or -1. */
  current: number;
  searching: boolean;
}

/** Find-in-document (Ctrl+F) — SearchBar drives it, PDFViewer draws the matches. */
export const search = writable<SearchState>({ open: false, query: '', matches: [], current: -1, searching: false });

/** Opens the search bar (or refocuses it if already open). */
export const searchFocusRequest = writable(0);

export function openSearch() {
  search.update((s) => ({ ...s, open: true }));
  searchFocusRequest.update((n) => n + 1);
}

export function closeSearch() {
  search.update((s) => ({ ...s, open: false }));
}
