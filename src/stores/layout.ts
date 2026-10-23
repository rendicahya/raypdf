import { writable } from 'svelte/store';
import { persistedWritable } from '../lib/utils/persist';

/** Whether the left page-thumbnail sidebar is visible in the editor. */
export const pageSidebarOpen = writable(true);

export const PAGE_SIDEBAR_MIN_WIDTH = 120;
export const PAGE_SIDEBAR_MAX_WIDTH = 480;
export const PAGE_SIDEBAR_DEFAULT_WIDTH = 176;

/** Width in CSS pixels of the left page-thumbnail sidebar, set by dragging its edge. */
export const pageSidebarWidth = persistedWritable('pageSidebarWidth', PAGE_SIDEBAR_DEFAULT_WIDTH);

export function togglePageSidebar() {
  pageSidebarOpen.update((open) => !open);
}
