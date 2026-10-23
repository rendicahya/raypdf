<script lang="ts" module>
  export interface ContextMenuItem {
    label: string;
    /** SVG path data for a 24×24 stroked icon. */
    icon?: string;
    /** Shortcut hint shown on the right, e.g. "Del". */
    hint?: string;
    danger?: boolean;
    disabled?: boolean;
    /** Draws a divider above this item. */
    separatorBefore?: boolean;
    onSelect: () => void;
  }
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { portal } from '../lib/utils/portal';

  interface Props {
    /** Viewport coordinates where the menu opens (usually the pointer). */
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
  }

  let { x, y, items, onClose }: Props = $props();

  let menuEl: HTMLDivElement;
  let left = $state(0);
  let top = $state(0);

  const MARGIN = 8;

  // Opens at the pointer, flipped back inside the viewport if it would spill
  // past the right or bottom edge.
  async function position() {
    left = x;
    top = y;
    await tick();
    const rect = menuEl.getBoundingClientRect();
    if (left + rect.width > window.innerWidth - MARGIN) left = Math.max(MARGIN, x - rect.width);
    if (top + rect.height > window.innerHeight - MARGIN) top = Math.max(MARGIN, window.innerHeight - rect.height - MARGIN);
    focusItem(0);
  }

  onMount(() => {
    position();

    // Anything outside the menu closes it — clicks, scrolling, resizing, or leaving the window.
    const onPointerDown = (e: PointerEvent) => {
      if (!menuEl.contains(e.target as Node)) onClose();
    };
    const close = () => onClose();
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  });

  function enabledButtons(): HTMLButtonElement[] {
    return Array.from(menuEl?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  }

  function focusItem(index: number) {
    const buttons = enabledButtons();
    if (buttons.length === 0) return;
    buttons[(index + buttons.length) % buttons.length].focus();
  }

  function onKeydown(e: KeyboardEvent) {
    const buttons = enabledButtons();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') focusItem(current + 1);
    else if (e.key === 'ArrowUp') focusItem(current - 1);
    else if (e.key === 'Home') focusItem(0);
    else if (e.key === 'End') focusItem(-1);
    else if (e.key === 'Escape' || e.key === 'Tab') onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function choose(item: ContextMenuItem) {
    onClose();
    item.onSelect();
  }
</script>

<div
  bind:this={menuEl}
  use:portal
  role="menu"
  tabindex="-1"
  class="fixed z-[100] min-w-48 rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-xl
    dark:border-neutral-700 dark:bg-neutral-900"
  style:left="{left}px"
  style:top="{top}px"
  onkeydown={onKeydown}
  oncontextmenu={(e) => e.preventDefault()}
>
  {#each items as item}
    {#if item.separatorBefore}
      <div role="separator" class="my-1 border-t border-neutral-200 dark:border-neutral-700"></div>
    {/if}
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      class="flex w-full items-center gap-2.5 px-3 py-1.5 text-left outline-none transition-colors
        disabled:pointer-events-none disabled:opacity-40 {item.danger
        ? 'text-red-600 hover:bg-red-50 focus:bg-red-50 dark:text-red-400 dark:hover:bg-red-950 dark:focus:bg-red-950'
        : 'text-neutral-700 hover:bg-neutral-100 focus:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:focus:bg-neutral-800'}"
      onclick={() => choose(item)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4 shrink-0">
        {#if item.icon}
          <path stroke-linecap="round" stroke-linejoin="round" d={item.icon} />
        {/if}
      </svg>
      <span class="flex-1 whitespace-nowrap">{item.label}</span>
      {#if item.hint}
        <span class="text-xs text-neutral-400 dark:text-neutral-500">{item.hint}</span>
      {/if}
    </button>
  {/each}
</div>
