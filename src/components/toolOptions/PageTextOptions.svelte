<script lang="ts">
  import { activeDocument } from '../../stores/editor';
  import { pageTextTab } from '../../stores/pageNumbersTool';
  import PanelHeader from './PanelHeader.svelte';
  import PageNumberOptions from './PageNumberOptions.svelte';
  import HeaderFooterOptions from './HeaderFooterOptions.svelte';

  // The Page numbers tool's panel: page numbers and the header and footer,
  // one tab each, since both write along the page edges.

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const TABS = [
    { value: 'numbers', label: 'Page numbers' },
    { value: 'headerFooter', label: 'Header & footer' },
  ] as const;

  // A dot on a tab whose text is on the document.
  const inUse = $derived({
    numbers: !!$activeDocument?.pageNumbers,
    headerFooter: !!$activeDocument?.headerFooter,
  });
</script>

<div>
  <PanelHeader title="Page numbers, header & footer" {onClose} />

  <div role="tablist" class="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1 text-xs dark:bg-neutral-800">
    {#each TABS as tab (tab.value)}
      <button
        type="button"
        role="tab"
        aria-selected={$pageTextTab === tab.value}
        class="flex items-center justify-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors
          {$pageTextTab === tab.value
          ? 'bg-white text-teal-700 shadow-sm dark:bg-neutral-900 dark:text-teal-300'
          : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'}"
        onclick={() => pageTextTab.set(tab.value)}
      >
        {tab.label}
        {#if inUse[tab.value]}
          <span class="h-1.5 w-1.5 rounded-full bg-teal-500" aria-label="(on)"></span>
        {/if}
      </button>
    {/each}
  </div>

  {#if $pageTextTab === 'headerFooter'}
    <HeaderFooterOptions />
  {:else}
    <PageNumberOptions />
  {/if}
</div>
