import { writable } from 'svelte/store';
import { persistedWritable } from '../lib/utils/persist';
import { DEFAULT_PAGE_NUMBERS, type PageNumberSettings } from '../lib/pdf/pageNumbers';
import { DEFAULT_HEADER_FOOTER_STYLE, type HeaderFooterStyle } from '../lib/pdf/headerFooter';

/**
 * The Page numbers tool (page numbers, header, and footer): opens its options panel. Like the Signature tool,
 * the page behaves like Move while it's on, and closing the panel turns it
 * off. The numbers and text belong to the document (PdfDocumentState.pageNumbers, headerFooter)
 * and stay on after the tool is turned off.
 */
export const pageNumbersToolMode = writable<boolean>(false);

/** The last style used, so numbering another document starts from it. */
export const lastPageNumberStyle = persistedWritable<PageNumberSettings>('pageNumberStyle', DEFAULT_PAGE_NUMBERS);

/** The look of the last header and footer, so another document's starts from it (the text isn't kept). */
export const lastHeaderFooterStyle = persistedWritable<HeaderFooterStyle>('headerFooterStyle', DEFAULT_HEADER_FOOTER_STYLE);

/** Which tab of the panel is showing. */
export const pageTextTab = persistedWritable<'numbers' | 'headerFooter'>('pageTextTab', 'numbers');
