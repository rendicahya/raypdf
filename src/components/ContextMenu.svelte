<script lang="ts" module>
  export interface ContextMenuItem {
    label: string;
    /** SVG path data for a 24×24 stroked icon. */
    icon?: string;
    /** A CSS color shown as a dot in place of the icon (e.g. a color choice). */
    swatch?: string;
    /** Shortcut hint shown on the right, e.g. "Del". */
    hint?: string;
    danger?: boolean;
    disabled?: boolean;
    /** Draws a divider above this item. */
    separatorBefore?: boolean;
    /** Makes this item open a submenu (on hover, click, or →) instead of running `onSelect`. */
    children?: ContextMenuItem[];
    onSelect?: () => void;
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

  // The open submenu: which item it belongs to, and whether it opens to the
  // left because there's no room on the right.
  let openSubmenu: number | null = $state(null);
  let submenuLeft = $state(false);

  async function showSubmenu(index: number, focusFirst = false) {
    if (openSubmenu !== index) {
      openSubmenu = index;
      submenuLeft = false;
      await tick();
      const sub = menuEl.querySelector<HTMLElement>('[data-submenu]');
      if (sub && sub.getBoundingClientRect().right > window.innerWidth - MARGIN) submenuLeft = true;
    }
    if (focusFirst) focusItem(0, 1);
  }

  function hideSubmenu() {
    if (openSubmenu === null) return;
    const parent = menuEl.querySelector<HTMLButtonElement>(`[data-level="0"][data-index="${openSubmenu}"]`);
    openSubmenu = null;
    parent?.focus();
  }

  function enabledButtons(level: number): HTMLButtonElement[] {
    return Array.from(
      menuEl?.querySelectorAll<HTMLButtonElement>(`button[data-level="${level}"]:not(:disabled)`) ?? [],
    );
  }

  function focusItem(index: number, level = 0) {
    const buttons = enabledButtons(level);
    if (buttons.length === 0) return;
    buttons[(index + buttons.length) % buttons.length].focus();
  }

  function onKeydown(e: KeyboardEvent) {
    const active = document.activeElement as HTMLButtonElement;
    const level = Number(active?.dataset?.level ?? 0);
    const buttons = enabledButtons(level);
    const current = buttons.indexOf(active);
    const index = Number(active?.dataset?.index);
    if (e.key === 'ArrowDown') focusItem(current + 1, level);
    else if (e.key === 'ArrowUp') focusItem(current - 1, level);
    else if (e.key === 'Home') focusItem(0, level);
    else if (e.key === 'End') focusItem(-1, level);
    else if (e.key === 'ArrowRight' && level === 0 && items[index]?.children) showSubmenu(index, true);
    else if ((e.key === 'ArrowLeft' || e.key === 'Escape') && level === 1) hideSubmenu();
    else if (e.key === 'Escape' || e.key === 'Tab') onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function choose(item: ContextMenuItem) {
    onClose();
    item.onSelect?.();
  }

  const itemClass = (item: ContextMenuItem) =>
    'flex w-full items-center gap-2.5 px-3 py-1.5 text-left outline-none transition-colors ' +
    'disabled:pointer-events-none disabled:opacity-40 ' +
    (item.danger
      ? 'text-red-600 hover:bg-red-50 focus:bg-red-50 dark:text-red-400 dark:hover:bg-red-950 dark:focus:bg-red-950'
      : 'text-neutral-700 hover:bg-neutral-100 focus:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:focus:bg-neutral-800');
</script>

{#snippet itemContent(item: ContextMenuItem)}
  {#if item.swatch}
    <span class="flex h-4 w-4 shrink-0 items-center justify-center">
      <span
        class="h-3.5 w-3.5 rounded-full border border-black/10 dark:border-white/20"
        style:background-color={item.swatch}
      ></span>
    </span>
  {:else}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4 shrink-0">
      {#if item.icon}
        <path stroke-linecap="round" stroke-linejoin="round" d={item.icon} />
      {/if}
    </svg>
  {/if}
  <span class="flex-1 whitespace-nowrap">{item.label}</span>
  {#if item.hint}
    <span class="text-xs text-neutral-400 dark:text-neutral-500">{item.hint}</span>
  {/if}
{/snippet}

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
  {#each items as item, index}
    {#if item.separatorBefore}
      <div role="separator" class="my-1 border-t border-neutral-200 dark:border-neutral-700"></div>
    {/if}
    {#if item.children}
      <div class="relative">
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openSubmenu === index}
          data-level="0"
          data-index={index}
          disabled={item.disabled}
          class="{itemClass(item)} {openSubmenu === index ? 'bg-neutral-100 dark:bg-neutral-800' : ''}"
          onpointerenter={() => showSubmenu(index)}
          onclick={() => showSubmenu(index, true)}
        >
          {@render itemContent(item)}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5 shrink-0 text-neutral-400">
            <path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" />
          </svg>
        </button>
        {#if openSubmenu === index}
          <div
            data-submenu
            role="menu"
            tabindex="-1"
            class="absolute top-0 -mt-1 min-w-32 rounded-lg border border-neutral-200 bg-white py-1 shadow-xl
              dark:border-neutral-700 dark:bg-neutral-900 {submenuLeft ? 'right-full mr-0.5' : 'left-full ml-0.5'}"
          >
            {#each item.children as child}
              {#if child.separatorBefore}
                <div role="separator" class="my-1 border-t border-neutral-200 dark:border-neutral-700"></div>
              {/if}
              <button
                type="button"
                role="menuitem"
                data-level="1"
                disabled={child.disabled}
                class={itemClass(child)}
                onclick={() => choose(child)}
              >
                {@render itemContent(child)}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <button
        type="button"
        role="menuitem"
        data-level="0"
        data-index={index}
        disabled={item.disabled}
        class={itemClass(item)}
        onpointerenter={() => (openSubmenu = null)}
        onclick={() => choose(item)}
      >
        {@render itemContent(item)}
      </button>
    {/if}
  {/each}
</div>
