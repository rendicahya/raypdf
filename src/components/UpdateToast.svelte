<script lang="ts">
  import { useRegisterSW } from 'virtual:pwa-register/svelte';

  const { needRefresh, updateServiceWorker } = useRegisterSW();
</script>

{#if $needRefresh}
  <div
    class="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border
      border-neutral-200 bg-white px-4 py-3 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
  >
    <span>A new version of RayPDF is available.</span>
    <button
      type="button"
      class="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white transition-colors
        hover:bg-blue-700"
      onclick={() => updateServiceWorker(true)}
    >
      Reload to update
    </button>
    <button
      type="button"
      aria-label="Dismiss"
      class="shrink-0 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
      onclick={() => ($needRefresh = false)}
    >
      ×
    </button>
  </div>
{/if}
