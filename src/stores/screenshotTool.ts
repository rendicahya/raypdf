import { writable } from 'svelte/store';
import { persistedWritable } from '../lib/utils/persist';

/** Screenshot tool: click the page to capture all of it, or drag a rectangle to capture an area. */
export const screenshotToolMode = writable<boolean>(false);

/** Render scale for captures: 1 is the page at 72 DPI, so 3 is about 216 DPI. */
export const screenshotScale = persistedWritable<number>('screenshotScale', 3);
export const SCREENSHOT_SCALES = [
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 3, label: '3×' },
  { value: 4, label: '4×' },
] as const;

/** Whether captures include what's been placed on the page (signatures, text, redactions, form values, markups). */
export const screenshotIncludeEdits = persistedWritable<boolean>('screenshotIncludeEdits', true);

/** What happens right after a capture: copy it to the clipboard, or download it as a PNG. */
export const screenshotDestination = persistedWritable<'clipboard' | 'download'>('screenshotDestination', 'clipboard');

export type ScreenshotResult =
  | {
      ok: true;
      blob: Blob;
      fileName: string;
      /** Whether the image also made it onto the clipboard (not every browser allows it). */
      copied: boolean;
      /** What was captured, for the toast; a screenshot unless given. */
      label?: string;
    }
  | { ok: false; message: string };

/** The most recent capture (or failure), shown as a toast with a Save button until dismissed. */
export const screenshotResult = writable<ScreenshotResult | null>(null);
