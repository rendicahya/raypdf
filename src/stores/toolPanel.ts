import { derived, writable } from 'svelte/store';
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
export type PanelTool =
  | 'signature'
  | 'redact'
  | 'text'
  | 'comment'
  | 'select'
  | 'screenshot'
  | 'pageNumbers'
  | 'watermark'
  | 'shapes'
  | 'crop'
  | 'image';

/**
 * The placed image whose properties the panel shows (ImageOptions), or null.
 * Not a tool: the page behaves like Move while it's open, and turning on any
 * tool closes it.
 */
export const imagePropertiesId = writable<string | null>(null);

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
  [signatureToolMode, redactMode, textToolMode, commentToolMode, textSelectMode, screenshotToolMode, pageNumbersToolMode, pageWatermarkToolMode, shapeToolMode, cropToolMode, imagePropertiesId],
  ([signature, redact, text, comment, select, screenshot, pageNumbers, watermark, shapes, crop, image]): PanelTool | null =>
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
                        : image
                          ? 'image'
                          : null,
);

const TOOL_MODES = [
  signatureToolMode,
  redactMode,
  textToolMode,
  commentToolMode,
  textSelectMode,
  screenshotToolMode,
  pageNumbersToolMode,
  pageWatermarkToolMode,
  shapeToolMode,
  cropToolMode,
];

/** Turns one tool on (and every other tool off) and shows its panel. */
function openPanelTool(mode: (typeof TOOL_MODES)[number]) {
  for (const tool of TOOL_MODES) if (tool !== mode) tool.set(false);
  mode.set(true);
  toolPanelOpen.set(true);
}

// Any tool turning on closes an image's properties.
for (const mode of TOOL_MODES) {
  mode.subscribe((on) => {
    if (on) imagePropertiesId.set(null);
  });
}

/** Shows a placed image's properties in the panel, with every tool off (Move). */
export function openImageProperties(id: string) {
  for (const tool of TOOL_MODES) tool.set(false);
  imagePropertiesId.set(id);
}

/** Opens Add Text and its panel, e.g. when a placed text box is double-clicked to edit it. */
export const openTextTool = () => openPanelTool(textToolMode);

/** Opens Shapes and its panel, e.g. when a placed shape is double-clicked to restyle it. */
export const openShapeTool = () => openPanelTool(shapeToolMode);

/** The tool whose options the right-hand panel is showing right now, if any. */
export const shownPanelTool = derived([activePanelTool, toolPanelOpen], ([tool, open]) =>
  tool === 'signature' ||
  tool === 'pageNumbers' ||
  tool === 'watermark' ||
  tool === 'crop' ||
  tool === 'image' ||
  (tool && open)
    ? tool
    : null,
);
