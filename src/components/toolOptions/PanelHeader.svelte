<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tooltip } from '../../lib/utils/tooltip';

  interface Props {
    title: string;
    onClose: () => void;
    closeLabel?: string;
    /** Extra buttons shown before the close button. */
    actions?: Snippet;
  }

  let { title, onClose, closeLabel = 'Hide options', actions }: Props = $props();
</script>

<div class="mb-3 flex items-center justify-between">
  <h3 class="text-sm font-semibold text-neutral-600 dark:text-neutral-300">{title}</h3>
  <div class="flex items-center gap-2">
    {@render actions?.()}
    <button
      type="button"
      aria-label={closeLabel}
      use:tooltip={closeLabel}
      class="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors
        hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      onclick={onClose}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
        <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  </div>
</div>
