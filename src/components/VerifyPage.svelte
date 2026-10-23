<script lang="ts">
  import { PDFDocument } from '@cantoo/pdf-lib';
  import UploadCard from './UploadCard.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import { extractVerificationRecord, type VerificationRecord } from '../lib/pdf/verification';

  const PDF_ACCEPT = 'application/pdf,.pdf';

  type Result =
    | { status: 'idle' }
    | { status: 'checking'; fileName: string }
    | { status: 'found'; fileName: string; record: VerificationRecord }
    | { status: 'not-found'; fileName: string }
    | { status: 'error'; fileName: string; message: string };

  let result: Result = $state({ status: 'idle' });

  async function onFile(files: File[]) {
    const file = files[0];
    if (!file) return;

    result = { status: 'checking', fileName: file.name };
    try {
      const bytes = await file.arrayBuffer();
      // updateMetadata: false — this is a read-only check, no reason to let
      // pdf-lib touch the ModDate/Producer fields of the file we're inspecting.
      // password: '' — Signy's own "secure" exports set no user password, only
      // an owner password to lock permissions, so an empty password decrypts
      // them (and is simply ignored for a file that isn't encrypted at all).
      const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false, password: '' });
      const record = extractVerificationRecord(pdfDoc);
      result = record ? { status: 'found', fileName: file.name, record } : { status: 'not-found', fileName: file.name };
    } catch (e) {
      result = {
        status: 'error',
        fileName: file.name,
        message: e instanceof Error ? e.message : 'Could not read this file as a PDF.',
      };
    }
  }

  function formatSignedAt(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const datePart = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const timePart = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${datePart}, ${timePart}`;
  }

  function checkAnother() {
    result = { status: 'idle' };
  }
</script>

<div class="fixed right-4 top-4 z-10">
  <ThemeToggle />
</div>

<div class="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-6 py-16">
  <div class="text-center">
    <h1 class="text-3xl font-semibold">Verify a PDF</h1>
    <p class="mt-2 text-neutral-500 dark:text-neutral-400">
      Check whether a PDF carries a Signy export record: the document id, name, and export time embedded when it
      was last saved from Signy.
    </p>
    <p class="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
      This confirms the file passed through Signy; it isn't a cryptographic guarantee the pages weren't edited
      afterward. Nothing here leaves your browser.
    </p>
  </div>

  {#if result.status === 'idle' || result.status === 'checking'}
    <div class="w-full max-w-md">
      <UploadCard
        title="Check a PDF"
        subtitle="Drag & drop or click to browse"
        accept={PDF_ACCEPT}
        errorMessage="Please choose a PDF file."
        onFiles={onFile}
      />
      {#if result.status === 'checking'}
        <p class="mt-3 text-center text-sm text-neutral-500 dark:text-neutral-400">Checking {result.fileName}…</p>
      {/if}
    </div>
  {:else}
    <div class="w-full max-w-md rounded-2xl border p-5
      {result.status === 'found'
        ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40'
        : result.status === 'not-found'
          ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
          : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40'}"
    >
      {#if result.status === 'found'}
        <div class="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-5 w-5 shrink-0">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span class="font-medium">Signy record found</span>
        </div>
        <dl class="mt-4 space-y-2 text-sm">
          <div class="flex justify-between gap-4">
            <dt class="text-neutral-500 dark:text-neutral-400">File</dt>
            <dd class="min-w-0 truncate text-right font-medium">{result.fileName}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-neutral-500 dark:text-neutral-400">Document name</dt>
            <dd class="min-w-0 truncate text-right font-medium">{result.record.documentName}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-neutral-500 dark:text-neutral-400">Exported</dt>
            <dd class="text-right font-medium">{formatSignedAt(result.record.signedAt)}</dd>
          </div>
          {#if result.record.watermarkText}
            <div class="flex justify-between gap-4">
              <dt class="text-neutral-500 dark:text-neutral-400">Watermark text</dt>
              <dd class="min-w-0 whitespace-pre-wrap text-right font-medium">{result.record.watermarkText}</dd>
            </div>
          {/if}
          <div class="flex justify-between gap-4">
            <dt class="text-neutral-500 dark:text-neutral-400">Document ID</dt>
            <dd class="min-w-0 truncate text-right font-mono text-xs">{result.record.documentId}</dd>
          </div>
        </dl>
      {:else if result.status === 'not-found'}
        <div class="flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-5 w-5 shrink-0">
            <circle cx="12" cy="12" r="9" />
            <path stroke-linecap="round" d="M12 8v5M12 16h.01" />
          </svg>
          <span class="font-medium">No Signy record found</span>
        </div>
        <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          "{result.fileName}" doesn't carry a Signy export record. It may never have gone through Signy, or the
          metadata was stripped or overwritten by another tool since.
        </p>
      {:else}
        <div class="flex items-center gap-2 text-red-700 dark:text-red-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-5 w-5 shrink-0">
            <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
          <span class="font-medium">Couldn't read this file</span>
        </div>
        <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{result.message}</p>
      {/if}
    </div>

    <button
      type="button"
      class="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
      onclick={checkAnother}
    >
      Check another PDF
    </button>
  {/if}

  <a href="#/" class="text-sm text-neutral-400 hover:text-neutral-600 hover:underline dark:hover:text-neutral-200">
    ← Back to Signy
  </a>
</div>
