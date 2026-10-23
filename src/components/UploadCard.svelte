<script lang="ts">
  import { isFileAccepted, formatFileSize } from '../lib/utils/fileValidation';

  interface Props {
    title: string;
    subtitle?: string;
    accept?: string;
    /** Allow selecting/dropping more than one file at once. */
    multiple?: boolean;
    /** Shown when a rejected file is dropped or picked. */
    errorMessage?: string;
    /** Maximum allowed size per file, in bytes. Oversized files are skipped with a warning rather than silently dropped. */
    maxSizeBytes?: number;
    onFiles: (files: File[]) => void;
  }

  let {
    title,
    subtitle = 'Drag & drop or click to browse',
    accept = '',
    multiple = false,
    errorMessage = 'That file type is not supported.',
    maxSizeBytes,
    onFiles,
  }: Props = $props();

  let isDragging = $state(false);
  let error: string | null = $state(null);
  let inputEl: HTMLInputElement;

  function handleFiles(files: FileList | null) {
    const candidates = multiple ? Array.from(files ?? []) : Array.from(files ?? []).slice(0, 1);
    if (candidates.length === 0) return;

    const typeAccepted = candidates.filter((file) => isFileAccepted(file, accept));
    if (typeAccepted.length === 0) {
      error = errorMessage;
      return;
    }

    if (!maxSizeBytes) {
      error = null;
      onFiles(typeAccepted);
      return;
    }

    const tooLarge = typeAccepted.filter((file) => file.size > maxSizeBytes);
    const sized = typeAccepted.filter((file) => file.size <= maxSizeBytes);

    if (sized.length === 0) {
      error = `File${tooLarge.length > 1 ? 's are' : ' is'} too large. The limit is ${formatFileSize(maxSizeBytes)}.`;
      return;
    }

    // Oversized files are always surfaced, even when other files in the same
    // drop are still accepted, so nothing silently disappears.
    error =
      tooLarge.length > 0
        ? `Skipped (over ${formatFileSize(maxSizeBytes)}): ${tooLarge.map((f) => f.name).join(', ')}`
        : null;
    onFiles(sized);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragging = false;
    handleFiles(e.dataTransfer?.files ?? null);
  }
</script>

<button
  type="button"
  class="group flex h-64 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed
    border-neutral-300 bg-neutral-50 p-8 text-center transition-colors hover:border-neutral-400 hover:bg-neutral-100
    dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
  class:border-blue-500={isDragging}
  class:bg-blue-50={isDragging}
  class:border-red-400={!!error}
  ondragover={(e) => { e.preventDefault(); isDragging = true; }}
  ondragleave={() => (isDragging = false)}
  ondrop={onDrop}
  onclick={() => inputEl.click()}
>
  <span class="text-lg font-medium">{title}</span>
  <span class="text-sm text-neutral-500 dark:text-neutral-400">{subtitle}</span>
  {#if error}
    <span class="text-sm text-red-600 dark:text-red-400">{error}</span>
  {/if}
</button>

<input
  bind:this={inputEl}
  type="file"
  {accept}
  {multiple}
  class="hidden"
  onchange={(e) => {
    handleFiles((e.target as HTMLInputElement).files);
    (e.target as HTMLInputElement).value = '';
  }}
/>
