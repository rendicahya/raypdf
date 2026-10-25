<script lang="ts">
  import { editorStore, activeDocument } from '../../stores/editor';
  import { tooltip } from '../../lib/utils/tooltip';
  import PanelHeader from './PanelHeader.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  // Every comment in the document, in reading order: by page, then top to bottom.
  const comments = $derived(
    [...($activeDocument?.comments ?? [])].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x),
  );
</script>

<div>
  <PanelHeader title="Comments" {onClose} />

  <p class="text-xs text-neutral-500 dark:text-neutral-400">
    Click on the page to leave a sticky note. Notes are saved as PDF comments, not drawn on the page.
  </p>

  <div class="mt-4">
    <h4 class="text-xs font-medium text-neutral-600 dark:text-neutral-300">
      In this document{comments.length > 0 ? ` (${comments.length})` : ''}
    </h4>
    {#if comments.length === 0}
      <p class="mt-1 text-xs text-neutral-400">No comments yet.</p>
    {:else}
      <ul class="mt-1 space-y-1">
        {#each comments as comment (comment.id)}
          <li class="group flex items-start gap-1">
            <button
              type="button"
              class="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-xs hover:bg-neutral-100
                dark:hover:bg-neutral-800"
              onclick={() => editorStore.goToPage(comment.page)}
            >
              <span class="block text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                Page {comment.page}
              </span>
              <span class="line-clamp-2 text-neutral-700 dark:text-neutral-200">
                {comment.text.trim() || 'Empty note'}
              </span>
            </button>
            <button
              type="button"
              aria-label="Delete comment"
              use:tooltip={'Delete comment'}
              class="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 opacity-0
                transition-opacity hover:bg-red-50 hover:text-red-500 focus:opacity-100 group-hover:opacity-100
                dark:hover:bg-red-950/50"
              onclick={() => editorStore.removeComment(comment.id)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
