<script lang="ts">
  import { markupColor } from '../../stores/markup';
  import { MARKUP_COLORS, MARKUP_LABELS } from '../../lib/pdf/highlight';
  import { MENU_ICONS } from '../../lib/utils/menuIcons';
  import { tooltip } from '../../lib/utils/tooltip';
  import type { MarkupKind } from '../../stores/editor';

  // The toolbar over selected text: the selection's font, highlight /
  // underline / strikethrough in the chosen color, and Comment. Its buttons
  // act on pointerdown (and click, for the keyboard), and it never takes
  // focus, so the text selection survives until a button uses it.

  interface Props {
    /** Where the bar's top centre goes, in page pixels. */
    anchor: { x: number; y: number };
    /** The selected text's font (lib/pdf/fontInfo.ts), once known. */
    font: { label: string; detail: string } | null;
    onMarkup: (e: Event, kind: MarkupKind) => void;
    onComment: (e: Event) => void;
    onPickColor: (e: Event, color: string) => void;
  }

  let { anchor, font, onMarkup, onComment, onPickColor }: Props = $props();
</script>

<div
  role="toolbar"
  aria-label="Mark up selected text"
  tabindex="-1"
  class="absolute z-50 flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-full border
    border-neutral-200 bg-white px-1.5 py-1 text-xs font-medium text-neutral-700 shadow-lg
    dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
  style:left="{anchor.x}px"
  style:top="{anchor.y}px"
  onpointerdown={(e) => {
    e.preventDefault();
    e.stopPropagation();
  }}
>
  {#if font}
    <span class="max-w-[13rem] truncate px-1.5 text-neutral-500 dark:text-neutral-400" use:tooltip={font.detail}>
      {font.label}
    </span>
    <span class="mx-1 h-4 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700"></span>
  {/if}
  <button
    type="button"
    class="flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors hover:bg-neutral-100
      dark:hover:bg-neutral-800"
    onpointerdown={(e) => onMarkup(e, 'highlight')}
    onclick={(e) => onMarkup(e, 'highlight')}
  >
    <span class="h-3 w-3 rounded-sm border border-black/10" style:background-color={$markupColor}></span>
    Highlight
  </button>
  {#each ['underline', 'strikeout'] as const as kind}
    <button
      type="button"
      aria-label={MARKUP_LABELS[kind]}
      use:tooltip={MARKUP_LABELS[kind]}
      class="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-neutral-100
        dark:hover:bg-neutral-800"
      onpointerdown={(e) => onMarkup(e, kind)}
      onclick={(e) => onMarkup(e, kind)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
        <path stroke-linecap="round" stroke-linejoin="round" d={MENU_ICONS[kind]} />
      </svg>
    </button>
  {/each}
  <button
    type="button"
    aria-label="Comment"
    use:tooltip={'Comment: highlight this text and add a note to it'}
    class="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-neutral-100
      dark:hover:bg-neutral-800"
    onpointerdown={onComment}
    onclick={onComment}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
      <path stroke-linecap="round" stroke-linejoin="round" d={MENU_ICONS.comment} />
    </svg>
  </button>
  <span class="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-700"></span>
  {#each MARKUP_COLORS as c}
    <button
      type="button"
      aria-label={c.label}
      aria-pressed={$markupColor === c.value}
      use:tooltip={c.label}
      class="mx-0.5 h-4 w-4 rounded-full border transition-transform hover:scale-110 {$markupColor === c.value
        ? 'border-neutral-700 ring-2 ring-blue-400/50 dark:border-white'
        : 'border-black/10 dark:border-white/20'}"
      style:background-color={c.value}
      onpointerdown={(e) => onPickColor(e, c.value)}
      onclick={(e) => onPickColor(e, c.value)}
    ></button>
  {/each}
</div>
