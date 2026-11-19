import type { PdfDocument } from './loader';

/**
 * The PDF's own links (Link annotations). pdf.js leaves them out of the
 * canvas render, so the editor lays a clickable box over each one: web and
 * mail links open in a new tab, links inside the document go to their page.
 */

export interface PageLink {
  id: string;
  /** [x1, y1, x2, y2] in PDF points. */
  rect: number[];
  /** A web or mail address pdf.js judged safe to open, or null. */
  url: string | null;
  /** The page (1-indexed) a link inside the document goes to, or null. */
  page: number | null;
}

const LINK_ANNOTATION = 2;

/** pdf.js's annotation data, loosely typed there: only the fields used here. */
interface LinkData {
  id: string;
  annotationType: number;
  rect: number[];
  hidden?: boolean;
  url?: string;
  dest?: string | unknown[];
  action?: string;
}

const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:'];

function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return SAFE_PROTOCOLS.includes(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}

async function destinationPage(pdfDoc: PdfDocument, dest: string | unknown[]): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await pdfDoc.getDestination(dest) : dest;
    const target = explicit?.[0];
    if (Number.isInteger(target)) return (target as number) + 1;
    if (target && typeof target === 'object') {
      return (await pdfDoc.getPageIndex(target as { num: number; gen: number })) + 1;
    }
  } catch {
    // A broken destination: the link just goes nowhere.
  }
  return null;
}

function namedActionPage(action: string | undefined, current: number, count: number): number | null {
  switch (action) {
    case 'NextPage':
      return Math.min(current + 1, count);
    case 'PrevPage':
      return Math.max(current - 1, 1);
    case 'FirstPage':
      return 1;
    case 'LastPage':
      return count;
    default:
      return null;
  }
}

/** The links on one page (1-indexed) that lead somewhere. */
export async function getPageLinks(pdfDoc: PdfDocument, pageNumber: number): Promise<PageLink[]> {
  const page = await pdfDoc.getPage(pageNumber);
  const annotations = (await page.getAnnotations({ intent: 'display' })) as LinkData[];
  const links = await Promise.all(
    annotations
      .filter((a) => a.annotationType === LINK_ANNOTATION && !a.hidden)
      .map(async (a): Promise<PageLink | null> => {
        const url = safeUrl(a.url);
        const target = url
          ? null
          : a.dest
            ? await destinationPage(pdfDoc, a.dest)
            : namedActionPage(a.action, pageNumber, pdfDoc.numPages);
        return url || target ? { id: a.id, rect: a.rect, url, page: target } : null;
      }),
  );
  return links.filter((l): l is PageLink => l !== null);
}
