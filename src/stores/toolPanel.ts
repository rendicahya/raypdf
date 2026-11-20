import { derived, writable } from 'svelte/store';
import { persistedWritable } from '../lib/utils/persist';
import { TOOL_MODES, TOOL_NAMES, activeTool, activateTool, turnOffTools, type ToolName } from './tools';

/** Tools whose options are shown in the right-hand panel while they're on. */
export type PanelTool = ToolName | 'image';

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

/** The active tool, if it's one with options (every tool has them), or an image's properties. */
export const activePanelTool = derived(
  [activeTool, imagePropertiesId],
  ([tool, image]): PanelTool | null => tool ?? (image ? 'image' : null),
);

/** Turns one tool on (and every other tool off) and shows its panel. */
function openPanelTool(name: ToolName) {
  activateTool(name);
  toolPanelOpen.set(true);
}

// Any tool turning on closes an image's properties.
for (const name of TOOL_NAMES) {
  TOOL_MODES[name].subscribe((on) => {
    if (on) imagePropertiesId.set(null);
  });
}

/** Shows a placed image's properties in the panel, with every tool off (Move). */
export function openImageProperties(id: string) {
  turnOffTools();
  imagePropertiesId.set(id);
}

/** Opens Add Text and its panel, e.g. when a placed text box is double-clicked to edit it. */
export const openTextTool = () => openPanelTool('text');

/** Opens Shapes and its panel, e.g. when a placed shape is double-clicked to restyle it. */
export const openShapeTool = () => openPanelTool('shapes');

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
