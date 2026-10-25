<script lang="ts">
  import { editorStore } from '../stores/editor';
  import { unlockPdf } from '../lib/pdf/password';
  import { isWrongPasswordError } from '../lib/pdf/loader';

  // Shown in place of a PDF that needs a password to open. Unlocking swaps
  // the document for a decrypted copy, so everything else (viewer,
  // thumbnails, export, verify) works on it as on any other PDF, and what
  // gets saved no longer needs the password.

  interface Props {
    id: string;
    file: File;
    /** A smaller layout, for the list of added files. */
    compact?: boolean;
  }

  let { id, file, compact = false }: Props = $props();

  let password = $state('');
  let unlocking = $state(false);
  let error: string | null = $state(null);

  async function onUnlock(e: SubmitEvent) {
    e.preventDefault();
    if (!password || unlocking) return;
    unlocking = true;
    error = null;
    try {
      editorStore.unlockDocument(id, await unlockPdf(file, password));
    } catch (err) {
      error = isWrongPasswordError(err)
        ? "That password isn't right."
        : err instanceof Error
          ? err.message
          : "This PDF couldn't be unlocked.";
    } finally {
      unlocking = false;
    }
  }
</script>

<form class="flex flex-col gap-2 {compact ? '' : 'w-full max-w-sm'}" onsubmit={onUnlock}>
  {#if !compact}
    <div class="flex items-center gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5 text-amber-500">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      {file.name} is password protected
    </div>
  {/if}
  <div class="flex items-center gap-2">
    <input
      type="password"
      autocomplete="current-password"
      placeholder="Password"
      aria-label="Password for {file.name}"
      class="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm focus:outline-none
        focus:ring-1 focus:ring-blue-400 dark:border-neutral-600 dark:bg-neutral-900"
      bind:value={password}
    />
    <button
      type="submit"
      disabled={!password || unlocking}
      class="shrink-0 rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white transition-colors
        hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {unlocking ? 'Unlocking…' : 'Unlock'}
    </button>
  </div>
  {#if error}
    <p class="text-xs text-red-600 dark:text-red-400">{error}</p>
  {:else if !compact}
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      The password stays on this device. Once unlocked, what you save opens without it, unless you set a new
      one in the save options.
    </p>
  {/if}
</form>
