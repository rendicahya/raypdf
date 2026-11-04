import { PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from '@cantoo/pdf-lib';
import { Lexer, type Token, type Tokens } from 'marked';

// Turns a Markdown file into a PDF, in the browser. Images are never fetched:
// a remote one would reveal the reader to its server, and a relative one isn't
// available, so a picture is written as its alt text.

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const BODY_SIZE = 11;
const CODE_SIZE = 9.5;
const LINE_SPACING = 1.4;
const BLOCK_GAP = 8;
const LIST_INDENT = 18;
const CELL_PADDING = 5;
const HEADING_SIZES = [22, 18, 15, 13, 11.5, 11];

const TEXT_COLOR = rgb(0.1, 0.1, 0.1);
const MUTED_COLOR = rgb(0.4, 0.4, 0.4);
const LINK_COLOR = rgb(0.05, 0.3, 0.75);
const RULE_COLOR = rgb(0.8, 0.8, 0.8);
const CODE_BACKGROUND = rgb(0.95, 0.95, 0.95);

/** Standard fonts only cover Western characters; these have a close ASCII form. */
const SUBSTITUTES: Record<string, string> = {
  ' ': ' ', '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≤': '<=', '≥': '>=',
  '≠': '!=', '✓': 'x', '✔': 'x', '✗': 'x', '−': '-', '‐': '-', '‑': '-',
};

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

interface Style {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  link?: string;
}
interface Run extends Style {
  text: string;
}
/** A run, or a forced line break. */
type Inline = Run | 'break';
interface Segment extends Style {
  text: string;
  font: PDFFont;
  size: number;
  x: number;
  width: number;
}
interface TextOptions {
  size?: number;
  bold?: boolean;
  color?: RGB;
}

export interface MarkdownPdf {
  file: File;
  /** How many characters the PDF's fonts couldn't draw (shown as "?"). */
  replacedCharacters: number;
}

type FontKey = 'regular' | 'bold' | 'italic' | 'boldItalic' | 'code' | 'codeBold' | 'codeItalic' | 'codeBoldItalic';

class Writer {
  private page!: PDFPage;
  private y = 0;
  /** x positions of the quote bars around whatever is being written. */
  private bars: number[] = [];
  replaced = 0;

  private constructor(
    readonly doc: PDFDocument,
    private readonly fonts: Record<FontKey, PDFFont>,
    private readonly allowed: Set<number>,
  ) {
    this.newPage();
  }

  static async create(): Promise<Writer> {
    const doc = await PDFDocument.create();
    const fonts: Record<FontKey, PDFFont> = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      italic: await doc.embedFont(StandardFonts.HelveticaOblique),
      boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
      code: await doc.embedFont(StandardFonts.Courier),
      codeBold: await doc.embedFont(StandardFonts.CourierBold),
      codeItalic: await doc.embedFont(StandardFonts.CourierOblique),
      codeBoldItalic: await doc.embedFont(StandardFonts.CourierBoldOblique),
    };
    return new Writer(doc, fonts, new Set(fonts.regular.getCharacterSet()));
  }

  private newPage(): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private font(style: Style): PDFFont {
    const suffix = style.bold && style.italic ? 'BoldItalic' : style.bold ? 'Bold' : style.italic ? 'Italic' : '';
    if (style.code) return this.fonts[`code${suffix}` as FontKey];
    return this.fonts[(suffix ? suffix[0].toLowerCase() + suffix.slice(1) : 'regular') as FontKey];
  }

  /** Makes text drawable: substitutes what it can, and counts what it can't. */
  private clean(text: string): string {
    let out = '';
    for (const char of text.replace(/\t/g, '    ')) {
      if (this.allowed.has(char.codePointAt(0)!)) out += char;
      else if (SUBSTITUTES[char]) out += SUBSTITUTES[char];
      else if (/[​-‍️\r\n]/.test(char)) continue;
      else {
        out += '?';
        this.replaced++;
      }
    }
    return out;
  }

  /** Moves down by `height`, starting a page if it won't fit, and returns the top of that space. */
  private advance(height: number): number {
    if (this.y - height < MARGIN) this.newPage();
    const top = this.y;
    this.y -= height;
    for (const x of this.bars) {
      this.page.drawRectangle({ x, y: this.y, width: 2, height, color: RULE_COLOR });
    }
    return top;
  }

  gap(height = BLOCK_GAP): void {
    // A gap at the top of a page is just lost space.
    if (this.y >= PAGE_HEIGHT - MARGIN) return;
    if (this.y - height < MARGIN) this.y = MARGIN;
    else this.advance(height);
  }

  /** Breaks runs into lines no wider than `width`. */
  private layout(inlines: Inline[], width: number, size: number, base: Style): Segment[][] {
    const lines: Segment[][] = [[]];
    let x = 0;
    const place = (text: string, style: Style) => {
      const font = this.font(style);
      const pieceSize = style.code ? size * 0.92 : size;
      lines[lines.length - 1].push({ ...style, text, font, size: pieceSize, x, width: font.widthOfTextAtSize(text, pieceSize) });
      x += lines[lines.length - 1].at(-1)!.width;
    };
    const breakLine = () => {
      const line = lines[lines.length - 1];
      if (line.at(-1)?.text === ' ') line.pop();
      lines.push([]);
      x = 0;
    };

    for (const inline of inlines) {
      if (inline === 'break') {
        breakLine();
        continue;
      }
      const style = { ...base, ...inline };
      const size_ = style.code ? size * 0.92 : size;
      const font = this.font(style);
      for (const word of this.clean(inline.text.replace(/\s+/g, ' ')).split(/( )/)) {
        if (!word) continue;
        if (word === ' ') {
          if (lines[lines.length - 1].length > 0) place(' ', style);
          continue;
        }
        let rest = word;
        if (x > 0 && x + font.widthOfTextAtSize(rest, size_) > width) breakLine();
        // A word wider than the whole line (a long URL) is cut to fit.
        while (font.widthOfTextAtSize(rest, size_) > width) {
          let cut = rest.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size_) > width) cut--;
          place(rest.slice(0, cut), style);
          breakLine();
          rest = rest.slice(cut);
        }
        place(rest, style);
      }
    }
    return lines;
  }

  private drawLine(line: Segment[], left: number, top: number, height: number, size: number, color: RGB): void {
    const baseline = top - height + (height - size) / 2 + size * 0.22;
    for (const seg of line) {
      if (seg.text === ' ' && !seg.link && !seg.strike) continue;
      const x = left + seg.x;
      const segColor = seg.link ? LINK_COLOR : color;
      if (seg.code && seg.text !== ' ') {
        this.page.drawRectangle({ x: x - 1, y: top - height + 1, width: seg.width + 2, height: height - 2, color: CODE_BACKGROUND });
      }
      if (seg.text !== ' ') this.page.drawText(seg.text, { x, y: baseline, size: seg.size, font: seg.font, color: segColor });
      if (seg.strike) {
        const y = baseline + seg.size * 0.3;
        this.page.drawLine({ start: { x, y }, end: { x: x + seg.width, y }, thickness: 0.6, color: segColor });
      }
      if (seg.link) {
        this.page.drawLine({ start: { x, y: baseline - 1.5 }, end: { x: x + seg.width, y: baseline - 1.5 }, thickness: 0.5, color: segColor });
        this.addLink(seg.link, x, top - height, seg.width, height);
      }
    }
  }

  private addLink(url: string, x: number, y: number, width: number, height: number): void {
    const annotation = this.doc.context.register(
      this.doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [x, y, x + width, y + height],
        Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
      }),
    );
    const key = PDFName.of('Annots');
    const existing = this.page.node.lookup(key);
    if (existing) (existing as unknown as { push(ref: unknown): void }).push(annotation);
    else this.page.node.set(key, this.doc.context.obj([annotation]));
  }

  /** A paragraph-like block, with an optional marker hanging to the left of its first line. */
  text(inlines: Inline[], left: number, right: number, options: TextOptions = {}, marker?: string): void {
    const size = options.size ?? BODY_SIZE;
    const height = size * LINE_SPACING;
    const lines = this.layout(inlines, right - left, size, { bold: options.bold });
    lines.forEach((line, i) => {
      const top = this.advance(height);
      if (i === 0 && marker) {
        const label = this.clean(marker);
        const font = this.fonts.regular;
        const x = left - font.widthOfTextAtSize(label, size) - 5;
        this.page.drawText(label, { x, y: top - height + (height - size) / 2 + size * 0.22, size, font, color: TEXT_COLOR });
      }
      this.drawLine(line, left, top, height, size, options.color ?? TEXT_COLOR);
    });
  }

  rule(left: number, right: number): void {
    const top = this.advance(BLOCK_GAP);
    this.page.drawLine({ start: { x: left, y: top - BLOCK_GAP / 2 }, end: { x: right, y: top - BLOCK_GAP / 2 }, thickness: 0.75, color: RULE_COLOR });
  }

  code(source: string, left: number, right: number): void {
    const font = this.fonts.code;
    const height = CODE_SIZE * LINE_SPACING;
    const perLine = Math.max(1, Math.floor((right - left - 16) / font.widthOfTextAtSize('M', CODE_SIZE)));
    for (const raw of source.split('\n')) {
      const clean = this.clean(raw);
      // Code keeps its spacing, so long lines are cut rather than rewrapped.
      for (let i = 0; i === 0 || i < clean.length; i += perLine) {
        const top = this.advance(height);
        this.page.drawRectangle({ x: left, y: top - height, width: right - left, height, color: CODE_BACKGROUND });
        const part = clean.slice(i, i + perLine);
        if (part) this.page.drawText(part, { x: left + 8, y: top - height + (height - CODE_SIZE) / 2 + CODE_SIZE * 0.22, size: CODE_SIZE, font, color: TEXT_COLOR });
      }
    }
  }

  withQuoteBar(x: number, write: () => void): void {
    this.bars.push(x);
    write();
    this.bars.pop();
  }

  table(token: Tokens.Table, left: number, right: number): void {
    const size = BODY_SIZE - 1;
    const height = size * LINE_SPACING;
    const columns = token.header.length;
    const allRows = [token.header, ...token.rows];
    const cells = allRows.map((row) => row.map((cell) => inlineRuns(cell.tokens)));

    // Columns get the width their longest line wants, shrunk evenly if that's too much.
    const wanted = Array.from({ length: columns }, (_, c) =>
      Math.max(
        ...cells.map((row, r) => {
          const line = this.layout(row[c] ?? [], 100000, size, { bold: r === 0 });
          return Math.max(...line.map((l) => l.reduce((sum, seg) => sum + seg.width, 0)));
        }),
      ) + CELL_PADDING * 2 + 0.5, // a little slack, so rounding can't cut the longest word
    );
    const total = wanted.reduce((a, b) => a + b, 0);
    const available = right - left;
    const fair = available / columns;
    let widths = wanted;
    if (total > available) {
      // Columns under a fair share keep their width; the rest split what's left.
      const small = wanted.filter((w) => w <= fair).reduce((a, b) => a + b, 0);
      const large = total - small;
      widths = wanted.map((w) => (w <= fair ? w : (w / large) * (available - small)));
    }
    const tableWidth = widths.reduce((a, b) => a + b, 0);

    const drawRow = (rowIndex: number) => {
      const isHeader = rowIndex === 0;
      const laidOut = cells[rowIndex].map((inlines, c) => this.layout(inlines, widths[c] - CELL_PADDING * 2, size, { bold: isHeader }));
      const lineCount = Math.max(...laidOut.map((l) => l.length));
      const rowHeight = lineCount * height + CELL_PADDING;
      const startsPage = this.y - rowHeight < MARGIN;
      if (startsPage && !isHeader) {
        this.newPage();
        drawRow(0); // the header again, on the new page
      }
      const top = this.advance(rowHeight);
      if (isHeader) {
        this.page.drawRectangle({ x: left, y: top - rowHeight, width: tableWidth, height: rowHeight, color: CODE_BACKGROUND });
      }
      let x = left;
      laidOut.forEach((lines, c) => {
        const align = token.align[c];
        lines.forEach((line, i) => {
          const lineWidth = line.reduce((sum, seg) => sum + seg.width, 0);
          const space = widths[c] - CELL_PADDING * 2 - lineWidth;
          const shift = align === 'right' ? space : align === 'center' ? space / 2 : 0;
          this.drawLine(line, x + CELL_PADDING + shift, top - CELL_PADDING / 2 - i * height, height, size, TEXT_COLOR);
        });
        x += widths[c];
      });
      this.page.drawLine({ start: { x: left, y: top - rowHeight }, end: { x: left + tableWidth, y: top - rowHeight }, thickness: 0.5, color: RULE_COLOR });
    };

    allRows.forEach((_, r) => drawRow(r));
  }
}

function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity]);
}

/** Only links a PDF reader can safely open become clickable. */
function safeLink(href: string): string | undefined {
  return /^(https?:|mailto:)/i.test(href) ? href : undefined;
}

function inlineRuns(tokens: Token[] | undefined, style: Style = {}): Inline[] {
  const out: Inline[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'strong':
        out.push(...inlineRuns((token as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case 'em':
        out.push(...inlineRuns((token as Tokens.Em).tokens, { ...style, italic: true }));
        break;
      case 'del':
        out.push(...inlineRuns((token as Tokens.Del).tokens, { ...style, strike: true }));
        break;
      case 'link': {
        const link = token as Tokens.Link;
        out.push(...inlineRuns(link.tokens, { ...style, link: safeLink(link.href) }));
        break;
      }
      case 'codespan':
        out.push({ ...style, code: true, text: decode((token as Tokens.Codespan).text) });
        break;
      case 'image': {
        const image = token as Tokens.Image;
        out.push({ ...style, italic: true, text: `[Image${image.text ? `: ${decode(image.text)}` : ''}]` });
        break;
      }
      case 'br':
        out.push('break');
        break;
      case 'html':
        break; // tags aren't text
      case 'text':
      case 'escape': {
        const text = token as Tokens.Text;
        if (text.tokens) out.push(...inlineRuns(text.tokens, style));
        else out.push({ ...style, text: decode(text.text) });
        break;
      }
      default:
        if ('text' in token && typeof token.text === 'string') out.push({ ...style, text: decode(token.text) });
    }
  }
  return out;
}

function writeBlocks(writer: Writer, tokens: Token[], left: number, right: number, inListItem = false): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const heading = token as Tokens.Heading;
        const size = HEADING_SIZES[heading.depth - 1];
        writer.gap(size * 0.6);
        writer.text(inlineRuns(heading.tokens), left, right, {
          size,
          bold: true,
          color: heading.depth === 6 ? MUTED_COLOR : TEXT_COLOR,
        });
        writer.gap(BLOCK_GAP / 2);
        break;
      }
      case 'paragraph':
        writer.text(inlineRuns((token as Tokens.Paragraph).tokens), left, right);
        writer.gap();
        break;
      case 'text': {
        // Text directly inside a tight list item.
        const text = token as Tokens.Text;
        writer.text(text.tokens ? inlineRuns(text.tokens) : [{ text: decode(text.text) }], left, right);
        break;
      }
      case 'list': {
        const list = token as Tokens.List;
        list.items.forEach((item, i) => writeListItem(writer, item, list, i, left, right));
        if (!inListItem) writer.gap();
        break;
      }
      case 'blockquote':
        writer.withQuoteBar(left, () => writeBlocks(writer, (token as Tokens.Blockquote).tokens, left + 12, right));
        writer.gap();
        break;
      case 'code':
        writer.code((token as Tokens.Code).text, left, right);
        writer.gap();
        break;
      case 'table':
        writer.table(token as Tokens.Table, left, right);
        writer.gap();
        break;
      case 'hr':
        writer.rule(left, right);
        writer.gap();
        break;
      // 'space', 'html', and link definitions draw nothing.
    }
  }
}

function writeListItem(writer: Writer, item: Tokens.ListItem, list: Tokens.List, index: number, left: number, right: number): void {
  const start = typeof list.start === 'number' ? list.start : 1;
  const marker = item.task ? (item.checked ? '[x]' : '[ ]') : list.ordered ? `${start + index}.` : '•';
  const indent = left + (item.task ? LIST_INDENT + 6 : LIST_INDENT);
  // marked may report a task's checkbox as its own token.
  const blocks = item.tokens.filter((t) => t.type !== 'checkbox');
  const [first, ...rest] = blocks;

  if (first && (first.type === 'text' || first.type === 'paragraph')) {
    const textToken = first as Tokens.Text;
    writer.text(textToken.tokens ? inlineRuns(textToken.tokens) : [{ text: decode(textToken.text) }], indent, right, {}, marker);
    writeBlocks(writer, rest, indent, right, true);
  } else {
    writer.text([{ text: '' }], indent, right, {}, marker);
    writeBlocks(writer, blocks, indent, right, true);
  }
}

/** A leading block of `key: value` lines is metadata, not a rule and a heading. */
function withoutFrontMatter(source: string): string {
  return source.replace(/^﻿?---\r?\n(?:[\w-]+:.*\r?\n|[ \t-].*\r?\n)*---\r?\n/, '');
}

export async function markdownToPdf(file: File): Promise<MarkdownPdf> {
  const source = withoutFrontMatter(await file.text());
  const writer = await Writer.create();
  writeBlocks(writer, new Lexer({ gfm: true }).lex(source), MARGIN, PAGE_WIDTH - MARGIN);

  const title = file.name.replace(/\.[^.]+$/, '');
  writer.doc.setTitle(title);
  const bytes = await writer.doc.save();
  return {
    file: new File([bytes as BlobPart], `${title}.pdf`, { type: 'application/pdf', lastModified: file.lastModified }),
    replacedCharacters: writer.replaced,
  };
}
