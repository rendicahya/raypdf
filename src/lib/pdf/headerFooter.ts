import { pageNumberAsLabel, type PageLabel, type PageNumberFont, type PageNumberSettings } from './pageNumbers';

/** The left, center, and right text of a header or footer. */
export type HeaderFooterLine = [left: string, center: string, right: string];

/** Text along the top and bottom of every page. Sizes are in PDF points, like page numbers. */
export interface HeaderFooterSettings {
  header: HeaderFooterLine;
  footer: HeaderFooterLine;
  /** First page (1-indexed) that gets them, so a cover page can stay clean. */
  fromPage: number;
  font: PageNumberFont;
  fontSize: number;
  /** Distance from the page edges. */
  margin: number;
  /** CSS hex color. */
  color: string;
}

/** What the panel remembers between documents: the look, not the text. */
export type HeaderFooterStyle = Pick<HeaderFooterSettings, 'font' | 'fontSize' | 'margin' | 'color'>;

export const DEFAULT_HEADER_FOOTER_STYLE: HeaderFooterStyle = {
  font: 'helvetica',
  fontSize: 9,
  margin: 28,
  color: '#525252',
};

/** Words in the text that are replaced on each page. */
export const HEADER_FOOTER_FIELDS: { token: string; label: string }[] = [
  { token: '{page}', label: 'Page number' },
  { token: '{pages}', label: 'Page count' },
  { token: '{date}', label: 'Date' },
  { token: '{file}', label: 'File name' },
];

export interface HeaderFooterValues {
  page: number;
  pages: number;
  /** The document's file name, without .pdf. */
  file: string;
  date: string;
}

/** Today's date as the header and footer show it. */
export function headerFooterDate(): string {
  return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function fileTitle(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '');
}

export function hasHeaderFooterText(settings: HeaderFooterSettings): boolean {
  return [...settings.header, ...settings.footer].some((text) => text.trim() !== '');
}

function fillFields(text: string, values: HeaderFooterValues): string {
  return text.replace(/\{(page|pages|date|file)\}/g, (_, key: keyof HeaderFooterValues) => String(values[key]));
}

const SLOTS = ['left', 'center', 'right'] as const;

/**
 * Everything written along the edges of `page`: its page number and its
 * header and footer text. The editor preview, screenshots, and export all
 * draw these, so they match.
 */
export function pageLabels(
  pageNumbers: PageNumberSettings | null,
  headerFooter: HeaderFooterSettings | null,
  page: number,
  pageCount: number,
  fileName: string,
  date: string,
): PageLabel[] {
  const labels: PageLabel[] = [];
  if (headerFooter && page >= headerFooter.fromPage) {
    const values = { page, pages: pageCount, file: fileTitle(fileName), date };
    for (const [vertical, line] of [
      ['top', headerFooter.header],
      ['bottom', headerFooter.footer],
    ] as const) {
      line.forEach((template, i) => {
        const text = fillFields(template, values).trim();
        if (text) labels.push({ ...headerFooter, position: `${vertical}-${SLOTS[i]}`, text });
      });
    }
  }
  const number = pageNumbers ? pageNumberAsLabel(pageNumbers, page, pageCount) : null;
  if (number) labels.push(number);
  return labels;
}
