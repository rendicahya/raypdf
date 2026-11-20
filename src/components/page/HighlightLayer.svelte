<script lang="ts">
  import { editorStore, type PlacedComment, type PlacedHighlight } from '../../stores/editor';
  import { MARKUP_LABELS, markupPaint } from '../../lib/pdf/highlight';
  import { getPageContext } from './pageContext.svelte';
  import MarkupOptionsBar from './MarkupOptionsBar.svelte';

  // The markups (highlight, underline, strikethrough) on one page, and the
  // selected one's options bar. They sit above the text layer so they can be
  // clicked (then recolored or removed) in Move mode; in every other mode they
  // let clicks through, so the Select tool can still select marked-up text.
  // The clickable box is the whole marked text; only the paint inside differs
  // by kind: the full box for a highlight, a thin line for the others.

  interface Props {
    highlights: PlacedHighlight[];
    /** For the options bar: whether the markup has a note yet. */
    comments: PlacedComment[];
    /** The page's total rotation, which turns underline and strikethrough lines. */
    pageRotation: number;
    /** Whether markups take clicks (only in Move mode). */
    interactive: boolean;
    /** The group of the selected comment, whose markup is outlined too. */
    commentGroup: string | null;
    onRemove: (groupId: string) => void;
    onComment: (groupId: string) => void;
  }

  let { highlights, comments, pageRotation, interactive, commentGroup, onRemove, onComment }: Props = $props();

  const selection = getPageContext().selection;
</script>

{#each highlights as h, i (h.id)}
  {@const isSelected = selection.highlightGroup === h.groupId || commentGroup === h.groupId}
  {@const isFirstOfGroup = highlights.findIndex((x) => x.groupId === h.groupId) === i}
  {@const paint = markupPaint(h, pageRotation)}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    data-highlight-group={h.groupId}
    role="group"
    tabindex={isFirstOfGroup ? 0 : -1}
    aria-label="{MARKUP_LABELS[h.kind]}. Press Delete to remove."
    class="absolute cursor-pointer {isSelected ? 'outline outline-2 outline-blue-400' : ''}"
    class:pointer-events-none={!interactive}
    style:left="{h.x}px"
    style:top="{h.y}px"
    style:width="{h.width}px"
    style:height="{h.height}px"
    onpointerdown={(e) => {
      e.stopPropagation();
      selection.highlightGroup = h.groupId;
    }}
    onfocus={() => (selection.highlightGroup = h.groupId)}
    onkeydown={(e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();
      onRemove(h.groupId);
    }}
  >
    <div
      class="pointer-events-none absolute"
      class:mix-blend-multiply={paint.multiply}
      style:left="{paint.x - h.x}px"
      style:top="{paint.y - h.y}px"
      style:width="{paint.width}px"
      style:height="{paint.height}px"
      style:background-color={paint.color}
    ></div>
  </div>
{/each}

<!-- The selected markup's own toolbar, kept outside the markup boxes, whose
     multiplied paint would tint anything inside them. -->
{#each highlights.filter((h) => h.groupId === selection.highlightGroup).slice(0, 1) as h (h.id)}
  <MarkupOptionsBar
    markup={h}
    hasNote={comments.some((c) => c.groupId === h.groupId)}
    onRecolor={(color) => editorStore.recolorHighlight(h.groupId, color)}
    onComment={() => onComment(h.groupId)}
    onRemove={() => onRemove(h.groupId)}
  />
{/each}
