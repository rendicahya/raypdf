<script lang="ts">
  import { fetchPdfFromUrl } from '../lib/pdf/fetchPdf';

  interface Props {
    onFile: (file: File) => void;
  }

  let { onFile }: Props = $props();

  let url = $state('');
  let loading = $state(false);
  let error: string | null = $state(null);

  async function open(e: SubmitEvent) {
    e.preventDefault();
    if (!url.trim() || loading) return;
    loading = true;
    error = null;
    try {
      onFile(await fetchPdfFromUrl(url));
      url = '';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not open that link.';
    } finally {
      loading = false;
    }
  }
</script>

<form class="flex flex-col gap-1.5" onsubmit={open}>
  <label for="pdf-url" class="text-xs text-neutral-500 dark:text-neutral-400">Or open a PDF from a link</label>
  <div class="flex gap-2">
    <input
      id="pdf-url"
      type="url"
      inputmode="url"
      placeholder="https://example.com/file.pdf"
      class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500
        focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
      bind:value={url}
      oninput={() => (error = null)}
    />
    <button
      type="submit"
      class="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors
        hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={loading || !url.trim()}
    >
      {loading ? 'Opening…' : 'Open'}
    </button>
  </div>
  {#if error}
    <p class="text-xs text-red-600 dark:text-red-400">{error}</p>
  {:else}
    <p class="text-xs text-neutral-400">
      Downloaded straight into your browser. Some sites don't allow this; then save the file and add it above.
    </p>
  {/if}
</form>
