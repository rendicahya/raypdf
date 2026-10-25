import {
  StandardFonts,
  rgb,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
  type RGB,
} from '@cantoo/pdf-lib';
import type { TextAlign, TextFontFamily, TextScript } from '../../stores/editor';
import { SCRIPT_SCALE, SCRIPT_SHIFT } from '../../stores/textTool';

type BasePdfFamily = 'helvetica' | 'times' | 'courier';

const STANDARD_FONTS: Record<BasePdfFamily, Record<'regular' | 'bold' | 'italic' | 'boldItalic', StandardFonts>> = {
  helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique,
  },
  times: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
    boldItalic: StandardFonts.TimesRomanBoldItalic,
  },
  courier: {
    regular: StandardFonts.Courier,
    bold: StandardFonts.CourierBold,
    italic: StandardFonts.CourierOblique,
    boldItalic: StandardFonts.CourierBoldOblique,
  },
};

/**
 * pdf-lib can only embed the 14 standard PDF fonts without shipping actual
 * font files (which Arial/Consolas are — proprietary Microsoft fonts this
 * app can't bundle). Arial and Consolas are offered as editor choices for
 * their on-screen look (see textTool.ts's FONT_FAMILY_CSS) but fall back to
 * their metrically closest standard equivalent when the PDF is exported.
 */
const PDF_BASE_FAMILY: Record<TextFontFamily, BasePdfFamily> = {
  helvetica: 'helvetica',
  arial: 'helvetica',
  times: 'times',
  courier: 'courier',
  consolas: 'courier',
};

/** Embeds (and caches per pdf-lib document) the standard font matching a family/bold/italic combination. */
export async function embedTextFont(
  pdfDoc: PDFDocument,
  fontFamily: TextFontFamily,
  bold: boolean,
  italic: boolean,
): Promise<PDFFont> {
  const variant = bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
  return pdfDoc.embedFont(STANDARD_FONTS[PDF_BASE_FAMILY[fontFamily]][variant]);
}

export function hexToRgb(hex: string): RGB {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return rgb(0, 0, 0);
  const [, r, g, b] = match;
  return rgb(parseInt(r, 16) / 255, parseInt(g, 16) / 255, parseInt(b, 16) / 255);
}

interface Spacing {
  letterSpacing: number;
  wordSpacing: number;
}

/**
 * Width of a string drawn with per-character letter spacing (between glyphs,
 * not after the last one) plus extra word spacing on every space.
 */
function measureLine(font: PDFFont, text: string, fontSize: number, spacing: Spacing): number {
  if (text.length === 0) return 0;
  const glyphWidth = font.widthOfTextAtSize(text, fontSize);
  const spaces = text.split(' ').length - 1;
  return glyphWidth + spacing.letterSpacing * (text.length - 1) + spacing.wordSpacing * spaces;
}

/** Wraps `text` (already split on explicit newlines by the caller) to fit within `maxWidth`, breaking on spaces. */
function wrapParagraph(font: PDFFont, paragraph: string, fontSize: number, spacing: Spacing, maxWidth: number): string[] {
  if (paragraph.length === 0) return [''];

  const words = paragraph.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measureLine(font, candidate, fontSize, spacing) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  return lines.length > 0 ? lines : [''];
}

export interface DrawTextBoxOptions {
  text: string;
  /** Left edge of the box, in PDF points. */
  x: number;
  /** Top edge of the box, in PDF points (PDF y-axis, so this is the larger y value). */
  topY: number;
  /** Box width, in PDF points — text wraps to fit. */
  width: number;
  /** Box height, in PDF points — only used for the background. */
  height: number;
  font: PDFFont;
  fontSize: number;
  color: RGB;
  /** Filled behind the whole box, if set. */
  background: RGB | null;
  opacity: number;
  letterSpacing: number;
  wordSpacing: number;
  /** Multiple of the font size. */
  lineHeight: number;
  underline: boolean;
  strikethrough: boolean;
  script: TextScript;
  align: TextAlign;
}

/**
 * Draws word-wrapped, letter- and word-spaced (and optionally underlined or
 * struck through) text into a box on a pdf-lib page. pdf-lib's own drawText
 * has no spacing support, so each line is drawn glyph-by-glyph with a
 * manually accumulated x offset instead of a single drawText call.
 *
 * Superscript/subscript text is drawn smaller and shifted from the normal
 * baseline, while lines keep the full font size's height, like the editor.
 */
export function drawTextBox(page: PDFPage, opts: DrawTextBoxOptions): void {
  const { text, x, topY, width, height, font, color, background, opacity, underline, strikethrough, script, align } =
    opts;
  const lineHeight = opts.fontSize * opts.lineHeight;
  // CSS centres each line's glyphs in its line box: the half-leading above
  // the text grows with the line height.
  const ascent = opts.fontSize * 0.8 + (lineHeight - opts.fontSize * 1.2) / 2;
  const fontSize = script === 'normal' ? opts.fontSize : opts.fontSize * SCRIPT_SCALE;
  const shift = SCRIPT_SHIFT[script] * opts.fontSize;
  const spacing = { letterSpacing: opts.letterSpacing, wordSpacing: opts.wordSpacing };

  if (background) {
    page.drawRectangle({ x, y: topY - height, width, height, color: background, opacity });
  }

  const lines = text
    .split('\n')
    .flatMap((paragraph) => wrapParagraph(font, paragraph, fontSize, spacing, width));

  lines.forEach((line, i) => {
    const baselineY = topY - ascent - i * lineHeight - shift;
    const lineWidth = measureLine(font, line, fontSize, spacing);
    const lineStartX = align === 'center' ? x + (width - lineWidth) / 2 : align === 'right' ? x + width - lineWidth : x;
    let cursorX = lineStartX;

    for (const char of line) {
      page.drawText(char, { x: cursorX, y: baselineY, size: fontSize, font, color, opacity });
      cursorX += font.widthOfTextAtSize(char, fontSize) + spacing.letterSpacing;
      if (char === ' ') cursorX += spacing.wordSpacing;
    }

    if (line.length === 0) return;
    const thickness = Math.max(0.5, fontSize * 0.05);
    const drawRule = (y: number) =>
      page.drawLine({
        start: { x: lineStartX, y },
        end: { x: lineStartX + lineWidth, y },
        thickness,
        color,
        opacity,
      });
    if (underline) drawRule(baselineY - fontSize * 0.12);
    if (strikethrough) drawRule(baselineY + fontSize * 0.3);
  });
}
