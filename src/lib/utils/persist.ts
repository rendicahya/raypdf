import { writable, type Writable } from 'svelte/store';

/**
 * A Svelte store backed by localStorage. Only for small, non-sensitive
 * preferences (text, booleans, enums) — per README.md's Principles, signature image data
 * must stay in IndexedDB, never localStorage.
 */
export function persistedWritable<T>(key: string, initialValue: T): Writable<T> {
  const storageKey = `signy:${key}`;

  function read(): T {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw !== null ? (JSON.parse(raw) as T) : initialValue;
    } catch {
      return initialValue;
    }
  }

  const store = writable<T>(read());

  store.subscribe((value) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Storage unavailable (e.g. private browsing quota) — fail silently, in-memory state still works.
    }
  });

  return store;
}
