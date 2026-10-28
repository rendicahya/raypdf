import { writable } from 'svelte/store';
import { clickToPlaceMode } from './clickToPlace';
import { redactMode } from './redact';
import { textToolMode } from './textTool';
import { commentToolMode } from './commentTool';
import { textSelectMode } from './textSelect';
import { screenshotToolMode } from './screenshotTool';
import { pageNumbersToolMode } from './pageNumbersTool';
import { pageWatermarkToolMode } from './pageWatermarkTool';
import { shapeToolMode } from './shapeTool';
import { cropToolMode } from './cropTool';

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

/** Turns the Signature tool on (and every other tool off), e.g. to edit a placed signature. */
export function openSignatureTool() {
  for (const tool of [
    redactMode,
    textToolMode,
    commentToolMode,
    textSelectMode,
    screenshotToolMode,
    pageNumbersToolMode,
    pageWatermarkToolMode,
    shapeToolMode,
    cropToolMode,
  ]) {
    tool.set(false);
  }
  signatureToolMode.set(true);
}
