import { writable } from 'svelte/store';

/** The file most recently handed to the browser to download, shown briefly by DownloadToast. */
export const lastDownload = writable<{ fileName: string; at: number } | null>(null);

export function notifyDownload(fileName: string): void {
  lastDownload.set({ fileName, at: Date.now() });
}
