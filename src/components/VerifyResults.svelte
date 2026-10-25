<script lang="ts">
  import { untrack } from 'svelte';
  import { PDFDocument } from '@cantoo/pdf-lib';
  import { extractVerificationRecord, type VerificationRecord } from '../lib/pdf/verification';

  interface Props {
    documents: { id: string; file: File }[];
  }

  let { documents }: Props = $props();

  type Result =
    | { status: 'checking' }
    | { status: 'found'; record: VerificationRecord }
    | { status: 'not-found' }
    | { status: 'error'; message: string };

  // Keyed by document id, so PDFs added while this view is open (e.g. dropped
  // onto the page) get checked too, and each file is only read once.
  let results: Record<string, Result> = $state({});

  $effect(() => {
    for (const doc of documents) {
      if (untrack(() => results[doc.id])) continue;
      results[doc.id] = { status: 'checking' };
      check(doc.id, doc.file);
    }
  });

  async function check(id: string, file: File) {
    try {
      const bytes = await file.arrayBuffer();
      // updateMetadata: false — this is a read-only check, no reason to let
      // pdf-lib touch the ModDate/Producer fields of the file we're inspecting.
      // password: '' — RayPDF's own "secure" exports set no user password, only
      // an owner password to lock permissions, so an empty password decrypts
      // them (and is simply ignored for a file that isn't encrypted at all).
      const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false, password: '' });
      const record = extractVerificationRecord(pdfDoc);
      results[id] = record ? { status: 'found', record } : { status: 'not-found' };
    } catch (e) {
      results[id] = {
        status: 'error',
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
</script>

<div class="flex w-full flex-col gap-3">
  <p class="text-center text-xs text-neutral-400 dark:text-neutral-500">
    Checks for the RayPDF export record (document id, name, and export time) embedded when a PDF is saved from
    RayPDF (or Signy, its earlier name). This confirms the file passed through RayPDF; it isn't a cryptographic guarantee the pages weren't edited
    afterward.
  </p>

  {#each documents as doc (doc.id)}
    {@const result = results[doc.id] ?? { status: 'checking' }}
    <div class="w-full rounded-2xl border p-5
      {result.status === 'found'
        ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40'
        : result.status === 'not-found'
          ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
          : result.status === 'error'
            ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
            : 'border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900'}"
    >
      {#if result.status === 'checking'}
        <p class="truncate text-sm text-neutral-500 dark:text-neutral-400">Checking {doc.file.name}…</p>
      {:else if result.status === 'found'}
        <div class="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-5 w-5 shrink-0">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span class="font-medium">RayPDF record found</span>
        </div>
        <dl class="mt-4 space-y-2 text-sm">
          <div class="flex justify-between gap-4">
            <dt class="text-neutral-500 dark:text-neutral-400">File</dt>
            <dd class="min-w-0 truncate text-right font-medium">{doc.file.name}</dd>
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
          <span class="font-medium">No RayPDF record found</span>
        </div>
        <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          "{doc.file.name}" doesn't carry a RayPDF export record. It may never have gone through RayPDF, or the
          metadata was stripped or overwritten by another tool since.
        </p>
      {:else}
        <div class="flex items-center gap-2 text-red-700 dark:text-red-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-5 w-5 shrink-0">
            <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
          <span class="min-w-0 truncate font-medium">Couldn't read {doc.file.name}</span>
        </div>
        <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{result.message}</p>
      {/if}
    </div>
  {/each}
</div>
