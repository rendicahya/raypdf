import { writable } from 'svelte/store';
import { persistedWritable } from '../lib/utils/persist';
import { DEFAULT_PAGE_WATERMARK, type PageWatermarkStyle } from '../lib/pdf/pageWatermark';

/**
 * The Watermark tool: opens its options panel. Like the Page numbers tool,
 * the page behaves like Move while it's on, and closing the panel turns it
 * off. The watermark belongs to the document (PdfDocumentState.pageWatermark)
 * and stays on after the tool is turned off.
 */
export const pageWatermarkToolMode = writable<boolean>(false);

/** The last watermark's look, so another document's starts from it. */
export const lastPageWatermarkStyle = persistedWritable<PageWatermarkStyle>('pageWatermarkStyle', DEFAULT_PAGE_WATERMARK);

/** The last picture used as a watermark this visit (pictures are kept in memory only). */
export const lastPageWatermarkImage = writable<string | null>(null);
