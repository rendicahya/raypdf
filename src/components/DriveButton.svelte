<script lang="ts">
  // "Open from Google Drive". Renders nothing in builds without Google
  // credentials. Shows its own progress and errors; picked files go to
  // `onFiles` like files from the computer would.
  import { isDriveConfigured, pickFromDrive, prepareDrive } from '../lib/cloud/googleDrive';
  import { tooltip } from '../lib/utils/tooltip';

  interface Props {
    variant: 'button' | 'link' | 'icon';
    onFiles: (files: File[]) => void;
    /** Takes over showing errors (the icon has no room for them). */
    onError?: (message: string | null) => void;
  }

  let { variant, onFiles, onError }: Props = $props();

  let busy = $state(false);
  let error: string | null = $state(null);
  let errorTimeout: ReturnType<typeof setTimeout> | undefined;

  function showError(message: string | null) {
    if (onError) {
      onError(message);
      return;
    }
    clearTimeout(errorTimeout);
    error = message;
    if (message) errorTimeout = setTimeout(() => (error = null), 6000);
  }

  // Start loading Google's scripts as soon as the pointer or focus arrives,
  // so the sign-in popup opens straight from the click.
  function warmUp() {
    if (isDriveConfigured && navigator.onLine) prepareDrive().catch(() => {});
  }

  async function open() {
    if (busy) return;
    busy = true;
    showError(null);
    try {
      const { files, messages } = await pickFromDrive();
      showError(messages.length > 0 ? messages.join(' ') : null);
      if (files.length > 0) onFiles(files);
    } catch (e) {
      showError((e as Error).message);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet driveIcon(cls: string)}
  {#if busy}
    <svg viewBox="0 0 24 24" fill="none" class="{cls} animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  {:else}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class={cls}>
      <path stroke-linecap="round" stroke-linejoin="round" d="M7 18a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19 10.5 3.75 3.75 0 0 1 18 18H7Z" />
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 11v5m0 0-2-2m2 2 2-2" />
    </svg>
  {/if}
{/snippet}

{#if isDriveConfigured}
  {#if variant === 'button'}
    <div class="flex flex-col items-center gap-2">
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm
          font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-60
          dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
        disabled={busy}
        onpointerenter={warmUp}
        onfocus={warmUp}
        onclick={open}
      >
        {@render driveIcon('h-4 w-4')}
        {busy ? 'Opening Google Drive…' : 'Open from Google Drive'}
      </button>
      {#if error}
        <p class="text-center text-xs text-red-600 dark:text-red-400">{error}</p>
      {/if}
    </div>
  {:else if variant === 'link'}
    <button
      type="button"
      class="cursor-pointer text-blue-600 hover:underline disabled:opacity-60 dark:text-blue-400"
      disabled={busy}
      onpointerenter={warmUp}
      onfocus={warmUp}
      onclick={open}
    >
      {busy ? 'Opening Drive…' : '+ From Google Drive'}
    </button>
    {#if error}
      <span class="basis-full text-right font-normal text-red-600 dark:text-red-400">{error}</span>
    {/if}
  {:else}
    <button
      type="button"
      aria-label="Add from Google Drive"
      use:tooltip={'Add from Google Drive'}
      class="flex shrink-0 items-center justify-center rounded-t-lg border border-b-0 border-neutral-200 px-3
        py-1.5 text-neutral-500 transition-colors hover:bg-neutral-100/60 hover:text-neutral-800
        dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100"
      disabled={busy}
      onpointerenter={warmUp}
      onfocus={warmUp}
      onclick={open}
    >
      {@render driveIcon('h-3.5 w-3.5')}
    </button>
  {/if}
{/if}
