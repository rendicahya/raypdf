import { derived } from 'svelte/store';
import { persistedWritable } from '../lib/utils/persist';
import { signatureToolMode } from './signatureTool';
import { redactMode } from './redact';
import { textToolMode } from './textTool';
import { commentToolMode } from './commentTool';
import { textSelectMode } from './textSelect';
import { screenshotToolMode } from './screenshotTool';
import { pageNumbersToolMode } from './pageNumbersTool';
import { pageWatermarkToolMode } from './pageWatermarkTool';
import { shapeToolMode } from './shapeTool';
import { cropToolMode } from './cropTool';

/** Tools whose options are shown in the right-hand panel while they're on. */
export type PanelTool = 'signature' | 'redact' | 'text' | 'comment' | 'select' | 'screenshot' | 'pageNumbers' | 'watermark' | 'shapes' | 'crop';

/** Width of the right-hand panel in CSS pixels (Tailwind w-72). */
export const TOOL_PANEL_WIDTH = 288;

/**
 * Whether the options panel shows for the tools other than Signature. Its ×
 * hides the panel without turning the tool off, and the edge tab brings it
 * back; the choice is remembered. Signature, Page numbers, Watermark, and Crop ignore this:
 * their panel is the whole tool, so closing the panel turns the tool off instead.
 */
export const toolPanelOpen = persistedWritable<boolean>('toolPanelOpen', true);

/** The active tool, if it's one with options (tools are mutually exclusive). */
export const activePanelTool = derived(
  [signatureToolMode, redactMode, textToolMode, commentToolMode, textSelectMode, screenshotToolMode, pageNumbersToolMode, pageWatermarkToolMode, shapeToolMode, cropToolMode],
  ([signature, redact, text, comment, select, screenshot, pageNumbers, watermark, shapes, crop]): PanelTool | null =>
    signature
      ? 'signature'
      : redact
        ? 'redact'
        : text
          ? 'text'
          : comment
            ? 'comment'
            : select
              ? 'select'
              : screenshot
                ? 'screenshot'
                : pageNumbers
                  ? 'pageNumbers'
                  : watermark
                    ? 'watermark'
                    : shapes
                      ? 'shapes'
                      : crop
                        ? 'crop'
                        : null,
);

/** The tool whose options the right-hand panel is showing right now, if any. */
export const shownPanelTool = derived([activePanelTool, toolPanelOpen], ([tool, open]) =>
  tool === 'signature' || tool === 'pageNumbers' || tool === 'watermark' || tool === 'crop' || (tool && open) ? tool : null,
);
