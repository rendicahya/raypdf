import { writable } from 'svelte/store';

/** Screenshot tool: click the page to capture all of it, or drag a rectangle to capture an area. */
export const screenshotToolMode = writable<boolean>(false);

export type ScreenshotResult =
  | {
      ok: true;
      blob: Blob;
      fileName: string;
      /** Whether the image also made it onto the clipboard (not every browser allows it). */
      copied: boolean;
    }
  | { ok: false; message: string };

/** The most recent capture (or failure), shown as a toast with a Save button until dismissed. */
export const screenshotResult = writable<ScreenshotResult | null>(null);
