<script lang="ts">
  import {
    screenshotScale,
    screenshotIncludeEdits,
    screenshotDestination,
    SCREENSHOT_SCALES,
  } from '../../stores/screenshotTool';
  import PanelHeader from './PanelHeader.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const segmentClass = (on: boolean) =>
    'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ' +
    (on
      ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
      : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200');
</script>

<div>
  <PanelHeader title="Screenshot" {onClose} />

  <p class="text-xs text-neutral-500 dark:text-neutral-400">
    Click a page to capture all of it, or drag to capture an area.
  </p>

  <div class="mt-4 flex flex-col gap-4 text-xs text-neutral-600 dark:text-neutral-300">
    <div>
      <h4 class="font-medium">After capturing</h4>
      <div class="mt-2 flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
        <button
          type="button"
          aria-pressed={$screenshotDestination === 'clipboard'}
          class={segmentClass($screenshotDestination === 'clipboard')}
          onclick={() => screenshotDestination.set('clipboard')}
        >
          Copy
        </button>
        <button
          type="button"
          aria-pressed={$screenshotDestination === 'download'}
          class={segmentClass($screenshotDestination === 'download')}
          onclick={() => screenshotDestination.set('download')}
        >
          Download PNG
        </button>
      </div>
    </div>

    <div>
      <h4 class="font-medium">Resolution</h4>
      <div class="mt-2 flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
        {#each SCREENSHOT_SCALES as option (option.value)}
          <button
            type="button"
            aria-pressed={$screenshotScale === option.value}
            class={segmentClass($screenshotScale === option.value)}
            onclick={() => screenshotScale.set(option.value)}
          >
            {option.label}
          </button>
        {/each}
      </div>
      <p class="mt-1 text-neutral-400">Higher is sharper, but makes a bigger image.</p>
    </div>

    <label class="flex items-start gap-2">
      <input
        type="checkbox"
        class="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-neutral-300 text-sky-600 focus:ring-sky-500
          dark:border-neutral-600"
        bind:checked={$screenshotIncludeEdits}
      />
      <span>Include what I've added (signatures, text, redactions, markups, form values)</span>
    </label>
  </div>
</div>
