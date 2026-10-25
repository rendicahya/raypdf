import { writable } from 'svelte/store';
import { persistedWritable } from '../lib/utils/persist';
import { DEFAULT_PAGE_NUMBERS, type PageNumberSettings } from '../lib/pdf/pageNumbers';

/**
 * The Page numbers tool: opens its options panel. Like the Signature tool,
 * the page behaves like Move while it's on, and closing the panel turns it
 * off. The numbers themselves belong to the document (PdfDocumentState.pageNumbers)
 * and stay on after the tool is turned off.
 */
export const pageNumbersToolMode = writable<boolean>(false);

/** The last style used, so numbering another document starts from it. */
export const lastPageNumberStyle = persistedWritable<PageNumberSettings>('pageNumberStyle', DEFAULT_PAGE_NUMBERS);
