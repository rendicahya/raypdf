<script lang="ts">
  import { MARKUP_COLORS, MARKUP_LABELS } from '../../lib/pdf/highlight';
  import { MENU_ICONS } from '../../lib/utils/menuIcons';
  import { tooltip } from '../../lib/utils/tooltip';
  import type { PlacedHighlight } from '../../stores/editor';

  // A selected markup's own toolbar: recolor (highlights only), comment, or
  // remove. PDFViewer keeps it outside the markup boxes, whose multiplied
  // paint would tint anything inside them.

  interface Props {
    /** The markup's first box, which the bar sits above (or below, near the page top). */
    markup: PlacedHighlight;
    /** Whether the markup already has a comment. */
    hasNote: boolean;
    onRecolor: (color: string) => void;
    onComment: () => void;
    onRemove: () => void;
  }

  let { markup: h, hasNote, onRecolor, onComment, onRemove }: Props = $props();
</script>

<div
  data-highlight-group={h.groupId}
  role="toolbar"
  aria-label="{MARKUP_LABELS[h.kind]} options"
  tabindex="-1"
  class="absolute z-40 flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-1.5 py-1
    shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
  style:left="{h.x}px"
  style:top={h.y < 40 ? `${h.y + h.height + 6}px` : `${h.y - 34}px`}
  onpointerdown={(e) => e.stopPropagation()}
>
  {#if h.kind === 'highlight'}
    {#each MARKUP_COLORS as c}
      <button
        type="button"
        aria-label={c.label}
        aria-pressed={h.color === c.value}
        use:tooltip={c.label}
        class="h-4 w-4 rounded-full border transition-transform hover:scale-110 {h.color === c.value
          ? 'border-neutral-700 ring-2 ring-blue-400/50 dark:border-white'
          : 'border-black/10 dark:border-white/20'}"
        style:background-color={c.value}
        onclick={() => onRecolor(c.value)}
      ></button>
    {/each}
    <span class="mx-0.5 h-4 w-px bg-neutral-200 dark:bg-neutral-700"></span>
  {/if}
  <button
    type="button"
    aria-label={hasNote ? 'Edit comment' : 'Add comment'}
    use:tooltip={hasNote ? 'Edit comment' : 'Add a comment to this text'}
    class="flex h-5 w-5 items-center justify-center rounded-full text-neutral-500 transition-colors
      hover:bg-amber-50 hover:text-amber-700 dark:text-neutral-400 dark:hover:bg-amber-950 dark:hover:text-amber-300"
    onclick={onComment}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
      <path stroke-linecap="round" stroke-linejoin="round" d={MENU_ICONS.comment} />
    </svg>
  </button>
  <button
    type="button"
    aria-label="Remove {MARKUP_LABELS[h.kind].toLowerCase()}"
    use:tooltip={`Remove ${MARKUP_LABELS[h.kind].toLowerCase()} (Delete)`}
    class="flex h-5 w-5 items-center justify-center rounded-full text-neutral-500 transition-colors
      hover:bg-red-50 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-950"
    onclick={onRemove}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
      <path stroke-linecap="round" stroke-linejoin="round" d={MENU_ICONS.delete} />
    </svg>
  </button>
</div>
