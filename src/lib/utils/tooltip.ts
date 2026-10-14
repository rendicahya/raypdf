/**
 * Svelte action that shows a tooltip immediately on hover — unlike the native
 * `title` attribute, which only appears after the browser's built-in delay.
 * The tooltip is appended to `document.body` with `position: fixed` (see
 * portal.ts for why fixed overlays can't live inside backdrop-filtered
 * ancestors like the floating toolbar) and placed above the element, or
 * below it if there isn't room.
 */
export function tooltip(node: HTMLElement, text: string) {
  let current = text;
  let tip: HTMLDivElement | null = null;

  function show() {
    if (!current || tip) return;
    tip = document.createElement('div');
    tip.setAttribute('role', 'tooltip');
    tip.textContent = current;
    tip.className =
      'pointer-events-none fixed z-[1000] max-w-xs rounded-md bg-neutral-900 px-2 py-1 text-xs text-white ' +
      'shadow-lg dark:bg-neutral-100 dark:text-neutral-900';
    document.body.appendChild(tip);
    position();
  }

  function position() {
    if (!tip) return;
    const rect = node.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const gap = 8;
    const margin = 4;
    let top = rect.top - tipRect.height - gap;
    if (top < margin) top = rect.bottom + gap;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - tipRect.width / 2, margin),
      window.innerWidth - tipRect.width - margin,
    );
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
  }

  function hide() {
    tip?.remove();
    tip = null;
  }

  node.addEventListener('mouseenter', show);
  node.addEventListener('mouseleave', hide);
  node.addEventListener('focus', show);
  node.addEventListener('blur', hide);
  node.addEventListener('pointerdown', hide);

  return {
    update(next: string) {
      current = next;
      if (tip) {
        tip.textContent = next;
        position();
      }
    },
    destroy() {
      hide();
      node.removeEventListener('mouseenter', show);
      node.removeEventListener('mouseleave', hide);
      node.removeEventListener('focus', show);
      node.removeEventListener('blur', hide);
      node.removeEventListener('pointerdown', hide);
    },
  };
}
