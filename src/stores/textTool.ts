import { writable } from 'svelte/store';
import { persistedWritable } from '../lib/utils/persist';
import type { TextAlign, TextFontFamily, TextScript } from './editor';

/** Whether the editor is in "click to add a text box" mode. */
export const textToolMode = writable(false);

/** The text box selected on the page, if any. The Add Text panel restyles it. */
export const selectedTextId = writable<string | null>(null);

/**
 * Style used for the next text box the user places, persisted so repeat
 * users don't have to re-pick font/size/color every time — same reasoning
 * as the watermark preferences in stores/watermark.ts.
 */
export const defaultTextFontFamily = persistedWritable<TextFontFamily>('textFontFamily', 'helvetica');
export const defaultTextFontSize = persistedWritable<number>('textFontSize', 18);
export const defaultTextBold = persistedWritable<boolean>('textBold', false);
export const defaultTextItalic = persistedWritable<boolean>('textItalic', false);
export const defaultTextUnderline = persistedWritable<boolean>('textUnderline', false);
export const defaultTextColor = persistedWritable<string>('textColor', '#000000');
export const defaultTextLetterSpacing = persistedWritable<number>('textLetterSpacing', 0);
export const defaultTextAlign = persistedWritable<TextAlign>('textAlign', 'left');
export const defaultTextStrikethrough = persistedWritable<boolean>('textStrikethrough', false);
export const defaultTextBackground = persistedWritable<string | null>('textBackground', null);
export const defaultTextOpacity = persistedWritable<number>('textOpacity', 1);
export const defaultTextWordSpacing = persistedWritable<number>('textWordSpacing', 0);
export const defaultTextLineHeight = persistedWritable<number>('textLineHeight', 1.2);
export const defaultTextScript = persistedWritable<TextScript>('textScript', 'normal');

export const TEXT_FONT_SIZE_MIN = 8;
export const TEXT_FONT_SIZE_MAX = 96;
export const TEXT_LETTER_SPACING_MIN = 0;
export const TEXT_LETTER_SPACING_MAX = 20;
export const TEXT_WORD_SPACING_MIN = 0;
export const TEXT_WORD_SPACING_MAX = 40;
export const TEXT_LINE_HEIGHT_MIN = 0.8;
export const TEXT_LINE_HEIGHT_MAX = 3;
export const TEXT_OPACITY_MIN = 0.1;

/** CSS text-decoration-line for a text box's underline/strikethrough. */
export function textDecoration(t: { underline: boolean; strikethrough: boolean }): string {
  const lines = [t.underline && 'underline', t.strikethrough && 'line-through'].filter(Boolean);
  return lines.length > 0 ? lines.join(' ') : 'none';
}

/** Superscript and subscript text is drawn at this fraction of the font size. */
export const SCRIPT_SCALE = 0.6;

/**
 * How far superscript/subscript text sits from the normal baseline, as a
 * fraction of the full font size (negative is up). Shared by the editor,
 * screenshots, and export so all three put it in the same place.
 */
export const SCRIPT_SHIFT: Record<TextScript, number> = {
  normal: 0,
  superscript: -0.33,
  subscript: 0.14,
};

/** Alphabetical by label — also the order the font dropdown lists them in. */
export const FONT_FAMILY_LABELS: Record<TextFontFamily, string> = {
  arial: 'Arial',
  consolas: 'Consolas',
  courier: 'Courier',
  helvetica: 'Helvetica',
  times: 'Times New Roman',
};

/**
 * CSS font stacks for the on-screen editor preview. Arial and Consolas
 * aren't among pdf-lib's embeddable standard PDF fonts (no font files ship
 * with this app — see textRender.ts), so on export they fall back to their
 * closest standard-font equivalent (Helvetica/Courier); this stack is what
 * the user actually sees and edits with in the browser.
 */
export const FONT_FAMILY_CSS: Record<TextFontFamily, string> = {
  arial: 'Arial, Helvetica, sans-serif',
  consolas: 'Consolas, "Courier New", monospace',
  courier: '"Courier New", Courier, monospace',
  helvetica: 'Helvetica, Arial, sans-serif',
  times: '"Times New Roman", Times, serif',
};
