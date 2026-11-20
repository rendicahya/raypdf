import { derived, get, type Writable } from 'svelte/store';
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

/**
 * Every tool's on/off store, by name. Tools are mutually exclusive: turning one
 * on turns the others off, and with none on the page behaves like Move. A new
 * tool is added here once; the toolbar, Escape, the options panel, and the
 * text-recognition area all go through this list. The order is the one
 * `activeTool` reports in.
 */
export const TOOL_MODES = {
  signature: signatureToolMode,
  redact: redactMode,
  text: textToolMode,
  comment: commentToolMode,
  select: textSelectMode,
  screenshot: screenshotToolMode,
  pageNumbers: pageNumbersToolMode,
  watermark: pageWatermarkToolMode,
  shapes: shapeToolMode,
  crop: cropToolMode,
} satisfies Record<string, Writable<boolean>>;

export type ToolName = keyof typeof TOOL_MODES;

export const TOOL_NAMES = Object.keys(TOOL_MODES) as ToolName[];

/** Turns every tool off, or every tool but `except`. */
export function turnOffTools(except?: ToolName): void {
  for (const name of TOOL_NAMES) if (name !== except) TOOL_MODES[name].set(false);
}

/** Turns one tool on and the others off. */
export function activateTool(name: ToolName): void {
  turnOffTools(name);
  TOOL_MODES[name].set(true);
}

/** The toolbar button: turns a tool off if it's on, or on (and the others off) if not. */
export function toggleTool(name: ToolName): void {
  if (get(TOOL_MODES[name])) TOOL_MODES[name].set(false);
  else activateTool(name);
}

/** The tool that's on, or null for Move. */
export const activeTool = derived(
  TOOL_NAMES.map((name) => TOOL_MODES[name]),
  (on): ToolName | null => TOOL_NAMES.find((_, i) => on[i]) ?? null,
);

/** Turns the Signature tool on (and every other tool off), e.g. to edit a placed signature. */
export function openSignatureTool(): void {
  activateTool('signature');
}
