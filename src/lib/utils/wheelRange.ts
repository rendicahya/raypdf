/**
 * Svelte action for `<input type="range">`: scrolling the mouse wheel over
 * the slider nudges it one step (up = increase, down = decrease) instead of
 * scrolling the page. Fires a regular `input` event so `bind:value` and any
 * listeners update exactly as if the slider had been dragged.
 */
export function wheelRange(node: HTMLInputElement) {
  function onWheel(e: WheelEvent) {
    if (node.disabled || e.deltaY === 0) return;
    e.preventDefault();
    const before = node.value;
    if (e.deltaY < 0) node.stepUp();
    else node.stepDown();
    if (node.value !== before) node.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Non-passive so preventDefault can stop the sidebar from scrolling.
  node.addEventListener('wheel', onWheel, { passive: false });

  return {
    destroy() {
      node.removeEventListener('wheel', onWheel);
    },
  };
}
