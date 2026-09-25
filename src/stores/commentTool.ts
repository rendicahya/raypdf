import { writable } from 'svelte/store';

/** Whether the editor is in "click to add a comment" mode. */
export const commentToolMode = writable(false);
