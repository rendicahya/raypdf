/**
 * Reads page numbers like "1-3, 5, 8-" (an open end runs to the last page)
 * into a sorted list without repeats, or null if any part isn't a page of
 * a `pageCount`-page document.
 */
export function parsePageRange(text: string, pageCount: number): number[] | null {
  const pages = new Set<number>();
  const parts = text
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    const match = part.match(/^(\d*)\s*[-–]\s*(\d*)$|^(\d+)$/);
    if (!match) return null;
    const [from, to] = match[3]
      ? [Number(match[3]), Number(match[3])]
      : [match[1] ? Number(match[1]) : 1, match[2] ? Number(match[2]) : pageCount];
    if (!match[3] && !match[1] && !match[2]) return null;
    if (from < 1 || to > pageCount || from > to) return null;
    for (let p = from; p <= to; p++) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

/** Sorted page numbers written as a short range: [1, 2, 3, 5] → "1-3, 5". */
export function formatPageRange(pages: number[]): string {
  const parts: string[] = [];
  let start = -1;
  let previous = -1;
  for (const page of [...pages].sort((a, b) => a - b)) {
    if (page === previous + 1 && start !== -1) {
      previous = page;
      continue;
    }
    if (start !== -1) parts.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = previous = page;
  }
  if (start !== -1) parts.push(start === previous ? `${start}` : `${start}-${previous}`);
  return parts.join(', ');
}
