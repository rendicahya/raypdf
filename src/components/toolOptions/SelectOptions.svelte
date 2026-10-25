<script lang="ts">
  import { markupColor } from '../../stores/markup';
  import { MARKUP_COLORS } from '../../lib/pdf/highlight';
  import { tooltip } from '../../lib/utils/tooltip';
  import PanelHeader from './PanelHeader.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();
</script>

<div>
  <PanelHeader title="Select" {onClose} />

  <p class="text-xs text-neutral-500 dark:text-neutral-400">
    Drag over the page to select its text. Copy it with Ctrl+C, or use the bar that appears to highlight,
    underline, or strike it through.
  </p>

  <div class="mt-4">
    <h4 class="text-xs font-medium text-neutral-600 dark:text-neutral-300">Highlight color</h4>
    <div class="mt-2 flex items-center gap-2">
      {#each MARKUP_COLORS as color (color.value)}
        <button
          type="button"
          aria-label={color.label}
          aria-pressed={$markupColor === color.value}
          use:tooltip={color.label}
          class="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110
            {$markupColor === color.value
            ? 'border-neutral-800 dark:border-neutral-100'
            : 'border-transparent'}"
          style:background-color={color.value}
          onclick={() => markupColor.set(color.value)}
        ></button>
      {/each}
    </div>
    <p class="mt-2 text-xs text-neutral-400">Used for the next highlight. Underlines and strikethroughs are always black.</p>
  </div>
</div>
