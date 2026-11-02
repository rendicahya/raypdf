import * as pdfjsLib from 'pdfjs-dist';
import { downloadBlob } from './screenshot';
import {
  allBold,
  groupLines,
  groupParagraphs,
  isColumnGap,
  LIST_MARKER,
  mostCommonSize,
  readTextPieces,
  type Line,
} from './textLayout';
import './loader'; // sets up the pdf.js worker

// Converts a PDF's text to Markdown, in the browser. The structure is rebuilt
// from positions like Save as Word (textLayout.ts): lines close together make
// one paragraph, written on one line. Headers and footers (text that repeats
// at the top or bottom of the pages, and page numbers) are left out. Bigger
// or bold short lines become headings, their level ranked by how big they
// are across the whole document, so the hierarchy holds on any page range.
// Pictures and tables aren't converted; table rows come out as lines of text.

export type MarkdownRun = { text: string; bold: boolean; italic: boolean };

export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | {
      kind: 'paragraph';
      runs: MarkdownRun[];
      /** '-' for a bullet, the marker ("3.", "2)") for a numbered item. */
      list: string | null;
    };

/** Every page's blocks, read once; toMarkdown writes any choice of pages from it. */
export type MarkdownSource = { pages: MarkdownBlock[][] };

export type MarkdownOptions = {
  /** Keep bold and italic as **bold** and *italic*. Headings are kept either way. */
  formatting: boolean;
};

type PageLines = { lines: Line[]; height: number };

// How far down (or up from the bottom) of the page a header (footer) may sit,
// and how many lines it may span.
const BAND = 0.12;
const BAND_LINES = 3;

export async function readMarkdownSource(
  bytes: Uint8Array,
  onProgress?: (page: number, pages: number) => void,
): Promise<MarkdownSource> {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  try {
    const pages: PageLines[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      onProgress?.(n, pdf.numPages);
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      // The operator list loads the fonts, whose names tell bold and italic.
      await page.getOperatorList();
      const pieces = await readTextPieces(page, viewport);
      pages.push({ lines: groupLines(pieces), height: viewport.height });
      page.cleanup();
    }

    const bodyPages = withoutHeadersAndFooters(pages);
    const bodySize = mostCommonSize(bodyPages.flatMap((lines) => lines.flatMap((l) => l.pieces)));
    const drafts = bodyPages.map((lines) => pageBlocks(lines, bodySize));
    return { pages: assignHeadingLevels(drafts) };
  } finally {
    await pdf.destroy();
  }
}

// ---------------------------------------------------------------------------
// Headers and footers

const PAGE_NUMBER =
  /^[\s\-–—|[(]*(?:page|pg\.?|p\.|halaman|hal\.?|seite|página|pagina)?\s*(?:\d{1,4}|[ivxlc]{1,7})(?:\s*(?:of|\/|dari|von|de|di)\s*\d{1,4})?[\s\-–—|\])]*$/i;

function bandKey(line: Line): string {
  return line.pieces
    .map((p) => p.text)
    .join(' ')
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function plainText(line: Line): string {
  return line.pieces.map((p) => p.text).join(' ');
}

/**
 * Drops the lines at the top and bottom of the pages that are page numbers,
 * or that repeat on other pages (numbers in them may change: "Chapter 2,
 * page 7"). Only the first and last few lines, near the edge, are candidates.
 */
function withoutHeadersAndFooters(pages: PageLines[]): Line[][] {
  const candidates = pages.map(({ lines, height }) => {
    const top = lines.slice(0, BAND_LINES).filter((l) => l.y - l.size < height * BAND);
    const bottom = lines.slice(-BAND_LINES).filter((l) => l.y > height * (1 - BAND));
    return { top: new Set(top), bottom: new Set(bottom) };
  });

  const counts = new Map<string, number>();
  for (const { top, bottom } of candidates) {
    const keys = new Set([...[...top].map((l) => 't' + bandKey(l)), ...[...bottom].map((l) => 'b' + bandKey(l))]);
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeats = (key: string) => {
    const count = counts.get(key) ?? 0;
    return pages.length >= 2 && count >= 2 && count >= pages.length * 0.3;
  };

  return pages.map(({ lines }, i) => {
    const { top, bottom } = candidates[i];
    return lines.filter((line) => {
      const inTop = top.has(line);
      if (!inTop && !bottom.has(line)) return true;
      if (PAGE_NUMBER.test(plainText(line))) return false;
      return !repeats((inTop ? 't' : 'b') + bandKey(line));
    });
  });
}

// ---------------------------------------------------------------------------
// Paragraphs and headings

type Draft =
  | { kind: 'heading'; style: HeadingStyle; text: string; depth: number }
  | { kind: 'paragraph'; runs: MarkdownRun[]; list: string | null };

type HeadingStyle = { size: number; bold: boolean };

// "2.1 Scope", not "2024 Annual Report".
const NUMBERED_HEADING = /^(\d{1,3}(?:\.\d{1,3})*)\.?\s+\S/;

function pageBlocks(lines: Line[], bodySize: number): Draft[] {
  if (lines.length === 0) return [];
  const contentLeft = Math.min(...lines.map((l) => l.left));
  const contentRight = Math.max(...lines.map((l) => l.right));

  const drafts: Draft[] = [];
  let previous: { style: HeadingStyle; bottom: number } | null = null;
  for (const paragraph of groupParagraphs(lines, contentLeft, contentRight)) {
    const runs = paragraphRuns(paragraph);
    const text = runs.map((r) => r.text).join('').trim();
    if (!text) continue;
    const style = headingStyle(paragraph, text, bodySize);
    const top = paragraph[0].y - paragraph[0].size;
    const bottom = paragraph.at(-1)!.y;

    if (style) {
      const last = drafts.at(-1);
      // A heading wrapped onto a second line reads as two short paragraphs.
      if (
        last?.kind === 'heading' &&
        previous &&
        sameStyle(previous.style, style) &&
        top - previous.bottom < style.size * 1.2
      ) {
        last.text = `${last.text} ${text}`;
      } else {
        const number = text.match(NUMBERED_HEADING);
        drafts.push({ kind: 'heading', style, text, depth: number ? number[1].split('.').length : 0 });
      }
      previous = { style, bottom };
      continue;
    }
    previous = null;

    // Matched on the text as the runs hold it, so the marker's length lines up.
    const marker = runs.map((r) => r.text).join('').match(LIST_MARKER);
    if (marker) {
      const symbol = marker[1];
      const ordered = /^\(?\d+[.)]$/.test(symbol);
      const bulleted = /^[•◦▪▫■□●○‣⁃∙·\-–—*]$/.test(symbol);
      if (ordered || bulleted) {
        drafts.push({
          kind: 'paragraph',
          runs: dropPrefix(runs, marker[0]),
          list: bulleted ? '-' : symbol.replace(/^\(/, ''),
        });
        continue;
      }
    }
    drafts.push({ kind: 'paragraph', runs, list: null });
  }
  return drafts;
}

function headingStyle(paragraph: Line[], text: string, bodySize: number): HeadingStyle | null {
  const size = Math.round(paragraph[0].size * 2) / 2;
  const bold = paragraph.every(allBold);
  if (text.length > 200 || paragraph.length > 3 || !/\p{L}/u.test(text)) return null;
  if (size >= bodySize * 1.12) return { size, bold };
  // Body-size bold lines are headings when short and not a sentence or a label.
  const short = paragraph.length === 1 && text.split(/\s+/).length <= 12;
  if (bold && short && size >= bodySize * 0.95 && !/[.,;:]$/.test(text) && !/^[•◦▪▫■□●○‣⁃∙·\-–—*]\s/.test(text)) {
    return { size, bold };
  }
  return null;
}

function sameStyle(a: HeadingStyle, b: HeadingStyle): boolean {
  return a.bold === b.bold && Math.abs(a.size - b.size) <= Math.max(a.size, b.size) * 0.04;
}

/**
 * Ranks the heading styles across the document: bigger text is a higher
 * level, and bold beats regular at the same size. Within one style, deeper
 * numbering ("2.1" under "2") goes one level down. Levels are then packed so
 * they run 1, 2, 3 without gaps.
 */
function assignHeadingLevels(pages: Draft[][]): MarkdownBlock[][] {
  const headings = pages.flat().filter((d): d is Extract<Draft, { kind: 'heading' }> => d.kind === 'heading');
  const styles: HeadingStyle[] = [];
  for (const { style } of [...headings].sort((a, b) => b.style.size - a.style.size || +b.style.bold - +a.style.bold)) {
    if (!styles.some((s) => sameStyle(s, style))) styles.push(style);
  }
  const rank = (style: HeadingStyle) => styles.findIndex((s) => sameStyle(s, style));
  const minDepth = new Map<number, number>();
  for (const h of headings) {
    if (h.depth === 0) continue;
    const r = rank(h.style);
    minDepth.set(r, Math.min(minDepth.get(r) ?? Infinity, h.depth));
  }
  // Each rank leaves room below it for its deepest numbering.
  const span = (r: number) => {
    const depths = headings.filter((h) => rank(h.style) === r && h.depth > 0).map((h) => h.depth);
    return depths.length ? Math.max(...depths) - (minDepth.get(r) ?? 0) + 1 : 1;
  };
  const start: number[] = [];
  styles.forEach((_, r) => (start[r] = r === 0 ? 0 : start[r - 1] + span(r - 1)));
  const rawLevel = (h: Extract<Draft, { kind: 'heading' }>) => {
    const r = rank(h.style);
    return start[r] + (h.depth > 0 ? h.depth - (minDepth.get(r) ?? h.depth) : 0);
  };
  const used = [...new Set(headings.map(rawLevel))].sort((a, b) => a - b);

  return pages.map((drafts) =>
    drafts.map((d): MarkdownBlock =>
      d.kind === 'heading'
        ? { kind: 'heading', level: Math.min(6, used.indexOf(rawLevel(d)) + 1), text: d.text }
        : d,
    ),
  );
}

/** The paragraph's text as one line, in runs of the same style. */
function paragraphRuns(lines: Line[]): MarkdownRun[] {
  const runs: MarkdownRun[] = [];
  const add = (run: MarkdownRun) => {
    const last = runs.at(-1);
    if (last && last.bold === run.bold && last.italic === run.italic) last.text += run.text;
    else runs.push({ ...run });
  };
  const lastText = () => runs.at(-1)?.text ?? '';

  lines.forEach((line, lineIndex) => {
    line.pieces.forEach((piece, pieceIndex) => {
      let text = piece.text.replace(/\s+/g, ' ');
      if (pieceIndex === 0 && lineIndex > 0) {
        // A word broken across lines with a hyphen is joined again.
        const before = lastText();
        if (/\p{L}-$/u.test(before) && /^\p{Ll}/u.test(text)) runs.at(-1)!.text = before.slice(0, -1);
        else if (!/\s$/.test(before) && !/^\s/.test(text)) text = ' ' + text;
      } else if (pieceIndex > 0) {
        const previous = line.pieces[pieceIndex - 1];
        const gap = piece.x - (previous.x + previous.width);
        const spaced = /\s$/.test(previous.text) || /^\s/.test(text);
        if (!spaced && (isColumnGap(previous, piece) || gap > piece.size * 0.15)) text = ' ' + text;
      }
      add({ text, bold: piece.bold, italic: piece.italic });
    });
  });
  return runs;
}

/** The runs without the first `prefix.length` characters (a list marker). */
function dropPrefix(runs: MarkdownRun[], prefix: string): MarkdownRun[] {
  let left = prefix.length;
  const out: MarkdownRun[] = [];
  for (const run of runs) {
    if (left >= run.text.length) {
      left -= run.text.length;
      continue;
    }
    out.push({ ...run, text: run.text.slice(left) });
    left = 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writing Markdown

/**
 * The blocks of the chosen pages (numbers from 1, in order), with paragraphs
 * that run on to the next page joined, and the heading levels present packed from 1.
 */
export function chooseBlocks(source: MarkdownSource, pageNumbers: number[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let lastPage = -1;
  for (const n of pageNumbers) {
    const page = source.pages[n - 1];
    if (!page) continue;
    page.forEach((block, i) => {
      const previous = blocks.at(-1);
      // A paragraph that runs on to the next page is one paragraph.
      if (i === 0 && n === lastPage + 1 && continuesParagraph(previous, block)) {
        const runs = (previous as Extract<MarkdownBlock, { kind: 'paragraph' }>).runs;
        const first = (block as Extract<MarkdownBlock, { kind: 'paragraph' }>).runs.map((run) => ({ ...run }));
        const tail = runs.at(-1)!;
        if (/\p{L}-$/u.test(tail.text)) tail.text = tail.text.slice(0, -1);
        else first[0] = { ...first[0], text: ' ' + first[0].text.trimStart() };
        (previous as Extract<MarkdownBlock, { kind: 'paragraph' }>).runs = [...runs, ...first];
        return;
      }
      // Copied (not structuredClone: the preview's source may be a Svelte proxy),
      // so joining and packing levels never change the source.
      blocks.push(block.kind === 'heading' ? { ...block } : { ...block, runs: block.runs.map((run) => ({ ...run })) });
    });
    lastPage = n;
  }

  // The levels present run from # without gaps, so a range from the middle reads right.
  const levels = [...new Set(blocks.flatMap((b) => (b.kind === 'heading' ? [b.level] : [])))].sort((a, b) => a - b);
  for (const block of blocks) if (block.kind === 'heading') block.level = levels.indexOf(block.level) + 1;
  return blocks;
}

/** The runs as they'd be written: one plain run without formatting, same-style runs merged with it. */
export function displayRuns(runs: MarkdownRun[], formatting: boolean): MarkdownRun[] {
  if (!formatting) return [{ text: runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim(), bold: false, italic: false }];
  // Spaces belong to whichever side keeps a run of one style together.
  const merged: MarkdownRun[] = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last && (!run.text.trim() || (last.bold === run.bold && last.italic === run.italic))) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}

/** Blocks from chooseBlocks as Markdown. */
export function writeMarkdown(blocks: MarkdownBlock[], options: MarkdownOptions): string {
  let out = '';
  blocks.forEach((block, i) => {
    const previous = blocks[i - 1];
    if (i > 0) {
      // Items of one list go on consecutive lines; a bullet list turning into a numbered one is a new list.
      const tight =
        previous.kind === 'paragraph' &&
        block.kind === 'paragraph' &&
        previous.list !== null &&
        block.list !== null &&
        (previous.list === '-') === (block.list === '-');
      out += tight ? '\n' : '\n\n';
    }
    if (block.kind === 'heading') {
      out += `${'#'.repeat(Math.max(1, block.level))} ${escapeInline(block.text.trim())}`;
    } else {
      const text = writeRuns(block.runs, options.formatting);
      if (block.list === '-') out += `- ${text}`;
      else if (block.list) out += `${block.list} ${text}`;
      else out += escapeLineStart(text);
    }
  });
  return out ? out + '\n' : '';
}

function continuesParagraph(previous: MarkdownBlock | undefined, block: MarkdownBlock): boolean {
  if (previous?.kind !== 'paragraph' || block.kind !== 'paragraph' || previous.list || block.list) return false;
  const end = previous.runs.map((r) => r.text).join('').trimEnd();
  const start = block.runs.map((r) => r.text).join('').trimStart();
  return !/[.!?:;"”’)\]]$/.test(end) && /^\p{Ll}/u.test(start);
}

function writeRuns(runs: MarkdownRun[], formatting: boolean): string {
  return displayRuns(runs, formatting)
    .map(({ text, bold, italic }) => {
      const [, lead, core, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
      if (!core) return text;
      const marker = bold && italic ? '***' : bold ? '**' : italic ? '*' : '';
      return `${lead}${marker}${escapeInline(core)}${marker}${trail}`;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeInline(text: string): string {
  return text.replace(/([\\`*_<[\]])/g, '\\$1');
}

// Text that Markdown would read as a heading, quote, list, or rule.
function escapeLineStart(text: string): string {
  return /^(#{1,6}(\s|$)|>|[-+*]\s|\d+[.)]\s|=+\s*$|-{3,}\s*$)/.test(text) ? `\\${text}` : text;
}

/** Saves the Markdown as original_filename.md. */
export function downloadMarkdown(markdown: string, originalFileName: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, `${originalFileName.replace(/\.pdf$/i, '')}.md`);
}
