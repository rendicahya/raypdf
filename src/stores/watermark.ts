import { get } from 'svelte/store';
import { persistedWritable } from '../lib/utils/persist';
import type { WatermarkOptions } from '../lib/watermark/visible';

/**
 * Watermark preferences persist across sessions (localStorage) so users
 * don't have to retype them every time they open the app. This is plain
 * text/boolean preference data, not the signature image itself, which
 * always stays in IndexedDB (see Principles in README.md).
 */

/** Custom text (multi-line) the user wants overlaid onto the signature at export time. */
export const watermarkText = persistedWritable<string>('watermarkText', '');

/** Watermark texts the user saved for reuse, newest first. Picking one fills watermarkText. */
export const savedWatermarkTexts = persistedWritable<string[]>('savedWatermarkTexts', []);

export const MAX_SAVED_WATERMARK_TEXTS = 20;

/** Saves the text (trimmed) to the top of the list; saving one that already exists moves it up. */
export function saveWatermarkText(text: string): void {
  const value = text.trim();
  if (!value) return;
  savedWatermarkTexts.update((list) =>
    [value, ...list.filter((t) => t !== value)].slice(0, MAX_SAVED_WATERMARK_TEXTS),
  );
}

export function removeSavedWatermarkText(text: string): void {
  savedWatermarkTexts.update((list) => list.filter((t) => t !== text));
}

/** Whether to stamp the current date/time onto the signature at export time. */
export const includeTimestamp = persistedWritable<boolean>('includeTimestamp', false);

export type WatermarkPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/** Where the watermark text sits on top of the signature image. */
export const watermarkPosition = persistedWritable<WatermarkPosition>('watermarkPosition', 'center');

/** Watermark font size, as a ratio of the signature image's height. Controlled by a slider in the UI. */
export const watermarkFontScale = persistedWritable<number>('watermarkFontScale', 0.12);

export const WATERMARK_FONT_SCALE_MIN = 0.06;
export const WATERMARK_FONT_SCALE_MAX = 0.24;
export const WATERMARK_FONT_SCALE_STEP = 0.01;

/** Watermark text color, as a CSS hex string. */
export const watermarkColor = persistedWritable<string>('watermarkColor', '#000000');

/** Watermark opacity, 0 (invisible) to 1 (fully opaque). Controlled by a slider in the UI. */
export const watermarkOpacity = persistedWritable<number>('watermarkOpacity', 0.25);

/** The current settings, as passed to applyVisibleWatermark (lib/watermark/visible.ts) by export and screenshots. */
export function currentWatermarkOptions(): WatermarkOptions {
  return {
    customText: get(watermarkText),
    includeTimestamp: get(includeTimestamp),
    position: get(watermarkPosition),
    fontScale: get(watermarkFontScale),
    color: get(watermarkColor),
    opacity: get(watermarkOpacity),
  };
}

export const WATERMARK_OPACITY_MIN = 0.05;
export const WATERMARK_OPACITY_MAX = 1;
export const WATERMARK_OPACITY_STEP = 0.05;
