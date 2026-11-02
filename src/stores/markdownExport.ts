import { writable } from 'svelte/store';
import { persistedWritable } from '../lib/utils/persist';

/**
 * The Markdown preview, when open, for the active document: `pages` are the
 * ones picked (the thumbnails' selection), or null for every page.
 */
export const markdownExport = writable<{ pages: number[] | null } | null>(null);

export function openMarkdownExport(pages: number[] | null = null): void {
  markdownExport.set({ pages });
}

export function closeMarkdownExport(): void {
  markdownExport.set(null);
}

/** Keep bold and italic in the Markdown; the last choice is remembered. */
export const markdownFormatting = persistedWritable<boolean>('markdownFormatting', true);
