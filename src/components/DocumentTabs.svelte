<script lang="ts">
  import { editorStore, activeDocument } from '../stores/editor';
  import { clearCachedPdf } from '../lib/pdf/docCache';
  import { hasDocumentEdits } from '../lib/pdf/export';
  import { portal } from '../lib/utils/portal';

  function selectDocument(id: string) {
    editorStore.setActiveDocument(id);
  }

  function onTabKeydown(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectDocument(id);
    }
  }

  function removeDocument(id: string) {
    clearCachedPdf(id);
    editorStore.removeDocument(id);
  }

  // Closing a tab whose signature/redactions were never saved/printed would
  // silently throw away that work, so confirm first — mirrors StartOverButton's
  // "you haven't saved anything yet" guard, just scoped to the tabs being closed.
  let pendingClose = $state<{ ids: string[]; label: string } | null>(null);
  const pendingUnsaved = $derived(pendingClose ? docsWithUnsavedWork(pendingClose.ids) : []);

  function docsWithUnsavedWork(ids: string[]) {
    return $editorStore.documents.filter(
      (d) =>
        ids.includes(d.id) &&
        (d.placedSignatures.length > 0 || hasDocumentEdits(d)) &&
        !d.exported,
    );
  }

  /** Closes the given tabs, first confirming if any of them has unsaved work. */
  function requestClose(ids: string[], label: string) {
    if (ids.length === 0) return;
    if (docsWithUnsavedWork(ids).length > 0) {
      pendingClose = { ids, label };
    } else {
      ids.forEach(removeDocument);
    }
  }

  function confirmClose() {
    if (pendingClose) pendingClose.ids.forEach(removeDocument);
    pendingClose = null;
  }

  function cancelClose() {
    pendingClose = null;
  }

  function closeDocument(e: MouseEvent, id: string) {
    e.stopPropagation();
    const doc = $editorStore.documents.find((d) => d.id === id);
    requestClose([id], doc?.file.name ?? 'this document');
  }

  // Middle-click closes a tab, like a browser. The mousedown handler suppresses
  // the middle-button autoscroll cursor that would otherwise appear.
  function onTabMouseDown(e: MouseEvent) {
    if (e.button === 1) e.preventDefault();
  }

  function onTabAuxClick(e: MouseEvent, id: string) {
    if (e.button === 1) closeDocument(e, id);
  }

  // ── Right-click context menu ────────────────────────────────────────────
  let menu: { x: number; y: number; docId: string } | null = $state(null);
  let menuEl: HTMLDivElement | null = $state(null);

  const menuDoc = $derived(
    menu ? ($editorStore.documents.find((d) => d.id === menu!.docId) ?? null) : null,
  );
  const otherIds = $derived(
    menu ? $editorStore.documents.filter((d) => d.id !== menu!.docId).map((d) => d.id) : [],
  );
  const rightIds = $derived.by(() => {
    if (!menu) return [];
    const idx = $editorStore.documents.findIndex((d) => d.id === menu!.docId);
    return idx === -1 ? [] : $editorStore.documents.slice(idx + 1).map((d) => d.id);
  });

  function openMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    menu = { x: e.clientX, y: e.clientY, docId: id };
  }

  function closeMenu() {
    menu = null;
  }

  // Nudge the menu back inside the viewport once its real size is known.
  $effect(() => {
    if (!menu || !menuEl) return;
    const rect = menuEl.getBoundingClientRect();
    const pad = 8;
    let x = menu.x;
    let y = menu.y;
    if (x + rect.width > window.innerWidth - pad) x = window.innerWidth - rect.width - pad;
    if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
    if (x !== menu.x || y !== menu.y) menu = { ...menu, x: Math.max(pad, x), y: Math.max(pad, y) };
  });

  // Dismiss on outside interaction. Deferred so the opening right-click doesn't
  // immediately close it.
  $effect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuEl && !menuEl.contains(e.target as Node)) closeMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('resize', closeMenu);
      window.addEventListener('scroll', closeMenu, true);
    });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  });

  function runMenuAction(fn: () => void) {
    fn();
    closeMenu();
  }

  const ACTIVE_TAB_CLASS =
    'border-neutral-200 bg-neutral-100 text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100';
  const INACTIVE_TAB_CLASS =
    'border-neutral-200 text-neutral-500 hover:bg-neutral-100/60 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/60';
  const MENU_ITEM_CLASS =
    'flex w-full items-center px-3 py-1.5 text-left text-xs text-neutral-700 transition-colors hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-neutral-800';
</script>

<div role="tablist" aria-label="Open documents" class="flex min-w-0 items-end gap-0.5 self-stretch">
  {#each $editorStore.documents as doc (doc.id)}
    {@const isActive = doc.id === $activeDocument?.id}
    <div
      role="tab"
      tabindex="0"
      aria-selected={isActive}
      title={doc.file.name}
      class="group flex min-w-0 max-w-[10rem] shrink-0 cursor-pointer items-center gap-1.5
        rounded-t-lg border border-b-0 px-3 py-1.5 text-xs transition-colors
        {isActive ? ACTIVE_TAB_CLASS : INACTIVE_TAB_CLASS}"
      onclick={() => selectDocument(doc.id)}
      onkeydown={(e) => onTabKeydown(e, doc.id)}
      oncontextmenu={(e) => openMenu(e, doc.id)}
      onmousedown={onTabMouseDown}
      onauxclick={(e) => onTabAuxClick(e, doc.id)}
    >
      {#if doc.placedSignatures.length > 0 || hasDocumentEdits(doc)}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          aria-label="Signed and/or redacted"
          class="h-3 w-3 shrink-0 text-emerald-500"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      {/if}
      <span class="min-w-0 flex-1 truncate">{doc.file.name}</span>
      <button
        type="button"
        aria-label="Close {doc.file.name}"
        class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-sm leading-none
          text-neutral-400 opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600
          group-hover:opacity-100 dark:hover:bg-red-950/50"
        onclick={(e) => closeDocument(e, doc.id)}
      >
        ×
      </button>
    </div>
  {/each}
</div>

{#if menu && menuDoc}
  <div
    bind:this={menuEl}
    use:portal
    class="fixed z-50 min-w-[11rem] overflow-hidden rounded-lg border border-neutral-200 bg-white py-1
      shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
    style="left: {menu.x}px; top: {menu.y}px;"
    role="menu"
    aria-label="Tab actions for {menuDoc.file.name}"
  >
    <button
      type="button"
      role="menuitem"
      class={MENU_ITEM_CLASS}
      onclick={() => runMenuAction(() => requestClose([menu!.docId], menuDoc!.file.name))}
    >
      Close
    </button>
    <button
      type="button"
      role="menuitem"
      class={MENU_ITEM_CLASS}
      disabled={otherIds.length === 0}
      onclick={() => runMenuAction(() => requestClose(otherIds, 'the other tabs'))}
    >
      Close others
    </button>
    <button
      type="button"
      role="menuitem"
      class={MENU_ITEM_CLASS}
      disabled={rightIds.length === 0}
      onclick={() => runMenuAction(() => requestClose(rightIds, 'the tabs to the right'))}
    >
      Close tabs to the right
    </button>
  </div>
{/if}

{#if pendingClose}
  <div use:portal class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div
      class="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl
        dark:border-neutral-800 dark:bg-neutral-900"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="close-tab-title"
    >
      <h2 id="close-tab-title" class="text-base font-semibold text-neutral-800 dark:text-neutral-100">
        {pendingUnsaved.length === 1
          ? "This document hasn't been saved"
          : `${pendingUnsaved.length} documents haven't been saved`}
      </h2>
      <p class="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        {#if pendingUnsaved.length === 1}
          "{pendingUnsaved[0].file.name}" has a signature and/or redaction in place but hasn't been
          saved or printed yet. Closing {pendingClose.ids.length === 1 ? 'this tab' : 'these tabs'} will
          discard it. Are you sure you want to continue?
        {:else}
          {pendingUnsaved.length} of the tabs you're closing have a signature and/or redaction in place
          but haven't been saved or printed yet. Closing them will discard that work. Are you sure you
          want to continue?
        {/if}
      </p>
      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100
            dark:text-neutral-300 dark:hover:bg-neutral-800"
          onclick={cancelClose}
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          onclick={confirmClose}
        >
          {pendingClose.ids.length === 1 ? 'Close Tab' : 'Close Tabs'}
        </button>
      </div>
    </div>
  </div>
{/if}
