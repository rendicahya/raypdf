<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tooltip } from '../lib/utils/tooltip';

  // A tool's button in the bottom toolbar: icon only, with a tooltip, filled
  // in the tool's colour while it's on.

  interface Props {
    label: string;
    tip: string;
    active: boolean;
    /** The classes while the tool is on, e.g. 'border-red-600 bg-red-600 text-white'. */
    activeClass: string;
    disabled?: boolean;
    /** For a button that opens a menu (Recognize text). */
    menuOpen?: boolean;
    onclick: (e: MouseEvent) => void;
    /** The icon's SVG content (24×24 view box, stroked). */
    children: Snippet;
  }

  let { label, tip, active, activeClass, disabled = false, menuOpen, onclick, children }: Props = $props();

  const OFF_CLASS =
    'border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800';
</script>

<button
  type="button"
  aria-label={label}
  aria-pressed={active}
  aria-haspopup={menuOpen === undefined ? undefined : 'menu'}
  aria-expanded={menuOpen}
  use:tooltip={tip}
  {disabled}
  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors
    disabled:cursor-not-allowed disabled:opacity-30 {active ? activeClass : OFF_CLASS}"
  {onclick}
>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
    {@render children()}
  </svg>
</button>
