import { writable } from 'svelte/store';

/** The Crop tool: drag on a page to frame the area to keep. */
export const cropToolMode = writable<boolean>(false);

/**
 * The frame being drawn, on `page`: its position and size as fractions (0 to 1)
 * of the page as shown, so it stays put through zooming.
 */
export interface CropFrame {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const cropFrame = writable<CropFrame | null>(null);

cropToolMode.subscribe((on) => {
  if (!on) cropFrame.set(null);
});
