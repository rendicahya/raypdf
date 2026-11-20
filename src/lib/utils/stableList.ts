/**
 * Keeps a filtered list's identity while its items don't change: returns
 * `prev` when `next` holds the very same items in the same order, else
 * `next`. A `$derived` that returns `prev` doesn't count as changed, so the
 * `{#each}` blocks and deriveds reading it don't re-run. PDFViewer uses it for
 * the items on its page, which would otherwise be rebuilt for every page on
 * every edit (each step of a drag included).
 */
export function sameItemsOr<T>(prev: T[], next: T[]): T[] {
  if (prev.length !== next.length) return next;
  for (let i = 0; i < next.length; i++) if (prev[i] !== next[i]) return next;
  return prev;
}

/**
 * A filter for one page's items that hands back the previous array while
 * nothing on that page changed (see `sameItemsOr`). One per list, per page.
 */
export function pageFilter<T extends { page: number }>(): (items: T[] | undefined, page: number) => T[] {
  let prev: T[] = [];
  return (items, page) => (prev = sameItemsOr(prev, items?.filter((item) => item.page === page) ?? []));
}
