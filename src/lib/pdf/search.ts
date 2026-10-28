import type { PdfDocument } from './loader';
import { getTotalRotation } from './loader';
import { renderTextLayer, cancelTextLayer } from './textLayer';
import { selectionToBoxes, type Box } from './highlight';

/**
 * Find-in-document (Ctrl+F). Matching is case-insensitive and treats any run
 * of whitespace as a single space, so a phrase still matches across the line
 * breaks and odd spacing PDFs are full of.
 *
 * Two sources are searched the same way: pdf.js's text content for counting
 * matches on every page, and the rendered text layer (lib/pdf/textLayer.ts)
 * for the on-screen position of matches on the current page. The text layer
 * holds one span per text item and a <br> wherever pdf.js marks an end of
 * line, so both read as the same text and their matches line up by index.
 */

export interface SearchMatch {
  /** 1-indexed page. */
  page: number;
  /** Which match on that page (0-based), in reading order. */
  index: number;
}

/** Lowercased text with whitespace runs collapsed, plus each character's index in the original. */
interface SearchText {
  text: string;
  sourceIndex: number[];
}

function toSearchText(raw: string): SearchText {
  let text = '';
  const sourceIndex: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      lastWasSpace = true;
      text += ' ';
    } else {
      lastWasSpace = false;
      text += ch.toLowerCase();
    }
    sourceIndex.push(i);
  }
  return { text, sourceIndex };
}

export function normalizeQuery(query: string): string {
  return toSearchText(query.trim()).text;
}

/** [start, end) ranges in `raw` of every (non-overlapping) match. */
function findInText(raw: string, query: string): [number, number][] {
  if (!query) return [];
  const { text, sourceIndex } = toSearchText(raw);
  const ranges: [number, number][] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(query, from);
    if (at === -1) break;
    ranges.push([sourceIndex[at], sourceIndex[at + query.length - 1] + 1]);
    from = at + query.length;
  }
  return ranges;
}

const pageTexts = new WeakMap<PdfDocument, Map<number, Promise<string>>>();

function pageText(doc: PdfDocument, pageNumber: number): Promise<string> {
  let cache = pageTexts.get(doc);
  if (!cache) {
    cache = new Map();
    pageTexts.set(doc, cache);
  }
  let text = cache.get(pageNumber);
  if (!text) {
    text = doc
      .getPage(pageNumber)
      .then((page) => page.getTextContent())
      .then((content) =>
        content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''),
      );
    cache.set(pageNumber, text);
  }
  return text;
}

/**
 * Every match of `query` in the document, page by page. `isCancelled` is
 * checked between pages, so a newer search can stop an older one early.
 */
export async function findMatches(
  doc: PdfDocument,
  query: string,
  isCancelled: () => boolean = () => false,
): Promise<SearchMatch[]> {
  const q = normalizeQuery(query);
  if (!q) return [];
  const matches: SearchMatch[] = [];
  for (let page = 1; page <= doc.numPages; page++) {
    if (isCancelled()) return matches;
    const count = findInText(await pageText(doc, page), q).length;
    for (let index = 0; index < count; index++) matches.push({ page, index });
  }
  return matches;
}

/**
 * The on-page boxes (one per line, in canvas pixels at `scale` and the view's
 * `extraRotation`, like a text selection's markup) of every match on each
 * page in `pages`. Each page's text layer is built off screen and measured
 * the same way PDFViewer boxes the matches it shows, so pages that aren't
 * mounted come out exactly where they would be on screen.
 */
export async function findMatchBoxes(
  doc: PdfDocument,
  query: string,
  pages: number[],
  scale: number,
  extraRotation: number,
): Promise<{ page: number; rects: Box[] }[]> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;overflow:hidden;';
  const layer = document.createElement('div');
  layer.className = 'pdf-text-layer';
  host.append(layer);
  document.body.append(host);

  const marks: { page: number; rects: Box[] }[] = [];
  try {
    for (const pageNumber of pages) {
      const page = await doc.getPage(pageNumber);
      const rotation = getTotalRotation(page, extraRotation);
      const viewport = page.getViewport({ scale, rotation });
      host.style.width = `${viewport.width}px`;
      host.style.height = `${viewport.height}px`;
      if (!(await renderTextLayer(doc, pageNumber, layer, scale, extraRotation))) continue;
      const origin = host.getBoundingClientRect();
      for (const range of findInTextLayer(layer, query)) {
        const rects = Array.from(range.getClientRects(), (r) => ({
          x: r.left - origin.left,
          y: r.top - origin.top,
          width: r.width,
          height: r.height,
        }));
        marks.push({ page: pageNumber, rects: selectionToBoxes(rects, rotation % 180 !== 0) });
      }
    }
  } finally {
    cancelTextLayer(layer);
    host.remove();
  }
  return marks;
}

/**
 * DOM ranges for every match of `query` in a rendered text layer, in the same
 * order findMatches counts them.
 */
export function findInTextLayer(layer: HTMLElement, query: string): Range[] {
  const q = normalizeQuery(query);
  if (!q) return [];

  // The layer's text as one string, remembering which text node each character came from.
  let raw = '';
  const owners: { node: Text | null; offset: number }[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = n as Text;
      for (let i = 0; i < text.data.length; i++) owners.push({ node: text, offset: i });
      raw += text.data;
    } else if ((n as Element).tagName === 'BR') {
      owners.push({ node: null, offset: 0 });
      raw += '\n';
    }
  }

  const ranges: Range[] = [];
  for (const [start, end] of findInText(raw, q)) {
    // A match can't start or end on a line break (it's collapsed into the
    // query's single space), but skip past one defensively.
    let s = start;
    while (s < end && !owners[s].node) s++;
    let e = end - 1;
    while (e > s && !owners[e].node) e--;
    const first = owners[s];
    const last = owners[e];
    if (!first.node || !last.node) continue;
    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset + 1);
    ranges.push(range);
  }
  return ranges;
}
