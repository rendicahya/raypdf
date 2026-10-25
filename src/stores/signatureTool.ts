import { writable } from 'svelte/store';
import { clickToPlaceMode } from './clickToPlace';

/**
 * The Signature tool: opens the right-hand signature panel (signatures,
 * placement helpers, watermark). On the canvas it behaves like Move, so
 * placed signatures can still be dragged around; click-to-place is a
 * sub-mode of it and switches off with it.
 */
export const signatureToolMode = writable<boolean>(false);

signatureToolMode.subscribe((on) => {
  if (!on) clickToPlaceMode.set(false);
});
