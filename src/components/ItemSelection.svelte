<script lang="ts">
  import { activeDocument, ITEM_LISTS, type ItemRef } from '../stores/editor';
  import {
    itemSelection,
    clearItemSelection,
    itemRefOf,
    isMultiSelectClick,
    sameItem,
    resolveItems,
    alignSelection,
    distributeSelection,
    moveSelectionBy,
    duplicateSelection,
    deleteSelection,
    type ResolvedItem,
  } from '../stores/itemSelection';
  import { unionBounds, visualBounds, type Alignment, type ArrangeItem, type Axis } from '../lib/utils/arrange';
  import { MENU_ICONS } from '../lib/utils/menuIcons';
  import { tooltip } from '../lib/utils/tooltip';

  // Several placed items selected together on one page (Shift-, Ctrl-, or
  // Cmd-click): outlines them, shows the arrange bar, drags them as one, and
  // handles the keyboard (arrows, Delete, Ctrl+D, Escape). One per page;
  // only the page holding the selection draws or acts on it.

  interface Props {
    pageNumber: number;
    /** The page's size in canvas pixels. */
    bounds: () => { width: number; height: number };
    /** The item this page has selected on its own, to start a selection from. */
    currentItem: () => ItemRef | null;
    /** Drops this page's own single selection, which the group replaces. */
    clearSingle: () => void;
  }

  let { pageNumber, bounds, currentItem, clearSingle }: Props = $props();

  // The page element this sits in, found from a hidden marker.
  let anchor: HTMLElement | undefined = $state();
  const wrapper = $derived(anchor?.parentElement ?? undefined);

  const KEYBOARD_MOVE_STEP = 10;

  const mine = $derived(
    $itemSelection && $activeDocument && $itemSelection.docId === $activeDocument.id && $itemSelection.page === pageNumber
      ? $itemSelection
      : null,
  );

  // Read from the document so outlines follow moves and undo.
  const items: ResolvedItem[] = $derived.by(() => {
    const doc = $activeDocument;
    if (!mine || !doc) return [];
    return mine.items.flatMap((ref) => {
      const found = (doc[ITEM_LISTS[ref.kind]] as (ArrangeItem & { id: string })[]).find((i) => i.id === ref.id);
      return found ? [{ ...found, kind: ref.kind, id: ref.id }] : [];
    });
  });

  const union = $derived(items.length > 0 ? unionBounds(items.map(visualBounds)) : null);

  // Everything selected was removed (undo, the item's own ×): nothing left to hold.
  $effect(() => {
    if (mine && items.length === 0) clearItemSelection();
  });

  function toggle(ref: ItemRef) {
    const doc = $activeDocument;
    if (!doc) return;
    let next: ItemRef[];
    if (mine) {
      next = mine.items.some((i) => sameItem(i, ref))
        ? mine.items.filter((i) => !sameItem(i, ref))
        : [...mine.items, ref];
    } else {
      const seed = currentItem();
      next = seed && !sameItem(seed, ref) ? [seed, ref] : [ref];
    }
    clearSingle();
    // An item focused before the group began would take the keys meant for the group.
    const active = document.activeElement as HTMLElement | null;
    if (active && wrapper?.contains(active)) active.blur();
    itemSelection.set(next.length > 0 ? { docId: doc.id, page: pageNumber, items: next } : null);
  }

  let drag: { pointerX: number; pointerY: number; start: ResolvedItem[]; key: string } | null = null;

  function onDragMove(e: PointerEvent) {
    if (!drag) return;
    moveSelectionBy(e.clientX - drag.pointerX, e.clientY - drag.pointerY, bounds(), drag.key, drag.start);
  }

  function onDragEnd() {
    drag = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
  }

  // Capture phase on the page, ahead of each item's own handlers.
  function onPointerDownCapture(e: PointerEvent) {
    if (isMultiSelectClick(e)) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      toggle(itemRefOf(e.target)!);
      return;
    }
    if (!mine || e.button !== 0) return;
    const ref = itemRefOf(e.target);
    if (!ref || !mine.items.some((i) => sameItem(i, ref))) return;
    if ((e.target as Element).closest('textarea, input, select')) return;
    // A selected item: the whole group moves with it.
    e.preventDefault();
    e.stopPropagation();
    drag = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      start: resolveItems(mine.items),
      key: `group-move-${crypto.randomUUID()}`,
    };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
  }

  $effect(() => {
    const el = wrapper;
    if (!el) return;
    el.addEventListener('pointerdown', onPointerDownCapture, true);
    return () => {
      el.removeEventListener('pointerdown', onPointerDownCapture, true);
      onDragEnd();
    };
  });

  // Any other click lets go of the group.
  function onWindowPointerDown(e: PointerEvent) {
    if (!mine) return;
    const target = e.target as Element | null;
    if (target?.closest?.('[data-item-selection-bar], [role="menu"]')) return;
    if (isMultiSelectClick(e)) return;
    const ref = itemRefOf(target);
    if (ref && mine.items.some((i) => sameItem(i, ref)) && wrapper?.contains(target)) return;
    clearItemSelection();
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (!mine || items.length === 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    // Not while focus is somewhere else that has its own keys (the page sidebar, a menu).
    if (target && target !== document.body && !target.closest('[data-pdf-scroll-container]')) return;

    const mod = e.ctrlKey || e.metaKey;
    let handled = true;
    if (e.key === 'Escape') clearItemSelection();
    else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
    else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd') duplicateSelection(bounds());
    else if (!mod && e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? 1 : KEYBOARD_MOVE_STEP;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      moveSelectionBy(dx, dy, bounds(), 'nudge-items');
    } else handled = false;
    if (!handled) return;
    e.preventDefault();
    // Ahead of the app's own keys: arrows would also turn the page.
    e.stopPropagation();
  }

  const single = $derived(items.length === 1);
  const ALIGN: { edge: Alignment; label: string; icon: string }[] = [
    { edge: 'left', label: 'Align left', icon: MENU_ICONS.alignLeft },
    { edge: 'center', label: 'Align centers horizontally', icon: MENU_ICONS.alignCenter },
    { edge: 'right', label: 'Align right', icon: MENU_ICONS.alignRight },
    { edge: 'top', label: 'Align top', icon: MENU_ICONS.alignTop },
    { edge: 'middle', label: 'Align middles vertically', icon: MENU_ICONS.alignMiddle },
    { edge: 'bottom', label: 'Align bottom', icon: MENU_ICONS.alignBottom },
  ];
  const DISTRIBUTE: { axis: Axis; label: string; icon: string }[] = [
    { axis: 'horizontal', label: 'Distribute horizontally', icon: MENU_ICONS.distributeH },
    { axis: 'vertical', label: 'Distribute vertically', icon: MENU_ICONS.distributeV },
  ];

  let barWidth = $state(0);
  const barLeft = $derived.by(() => {
    if (!union) return 0;
    const pageWidth = bounds().width;
    const centre = (union.left + union.right) / 2;
    return Math.min(Math.max(centre - barWidth / 2, 0), Math.max(0, pageWidth - barWidth));
  });
  const barTop = $derived(union ? (union.top >= 44 ? union.top - 40 : union.bottom + 8) : 0);
</script>

<svelte:window onpointerdowncapture={onWindowPointerDown} onkeydowncapture={onWindowKeydown} />

<span bind:this={anchor} hidden></span>

{#if union}
  {#each items as item (item.kind + item.id)}
    <div
      class="pointer-events-none absolute z-30 rounded-sm ring-2 ring-blue-500"
      style:left="{item.x}px"
      style:top="{item.y}px"
      style:width="{item.width}px"
      style:height="{item.height}px"
      style:transform={item.angle ? `rotate(${item.angle}deg)` : undefined}
    ></div>
  {/each}

  {#if items.length > 1}
    <div
      class="pointer-events-none absolute z-30 border border-dashed border-blue-500/80"
      style:left="{union.left - 4}px"
      style:top="{union.top - 4}px"
      style:width="{union.right - union.left + 8}px"
      style:height="{union.bottom - union.top + 8}px"
    ></div>
  {/if}

  <div
    data-item-selection-bar
    role="toolbar"
    aria-label="{items.length} selected"
    tabindex="-1"
    bind:clientWidth={barWidth}
    class="absolute z-40 flex items-center gap-0.5 whitespace-nowrap rounded-full border border-neutral-200 bg-white
      px-1.5 py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
    style:left="{barLeft}px"
    style:top="{barTop}px"
    onpointerdown={(e) => e.stopPropagation()}
  >
    <span class="px-1.5 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">{items.length}</span>
    <span class="mx-0.5 h-4 w-px bg-neutral-200 dark:bg-neutral-700"></span>
    {#each ALIGN as a, i}
      {#if i === 3}<span class="mx-0.5 h-4 w-px bg-neutral-200 dark:bg-neutral-700"></span>{/if}
      {@render barButton(single ? `${a.label} of the page` : a.label, a.icon, false, () => alignSelection(a.edge, bounds()))}
    {/each}
    <span class="mx-0.5 h-4 w-px bg-neutral-200 dark:bg-neutral-700"></span>
    {#each DISTRIBUTE as d}
      {@render barButton(
        items.length < 3 ? `${d.label} (select 3 or more)` : d.label,
        d.icon,
        items.length < 3,
        () => distributeSelection(d.axis),
      )}
    {/each}
    <span class="mx-0.5 h-4 w-px bg-neutral-200 dark:bg-neutral-700"></span>
    {@render barButton('Duplicate (Ctrl+D)', MENU_ICONS.duplicate, false, () => duplicateSelection(bounds()))}
    {@render barButton('Delete (Del)', MENU_ICONS.delete, false, deleteSelection, true)}
  </div>
{/if}

{#snippet barButton(label: string, icon: string, disabled: boolean, onclick: () => void, danger = false)}
  <button
    type="button"
    aria-label={label}
    use:tooltip={label}
    {disabled}
    class="flex h-6 w-6 items-center justify-center rounded-full text-neutral-600 transition-colors
      disabled:cursor-not-allowed disabled:opacity-35 dark:text-neutral-300 {danger
      ? 'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950'
      : 'hover:bg-neutral-100 hover:text-neutral-900 enabled:dark:hover:bg-neutral-800 dark:hover:text-white'}"
    {onclick}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-4 w-4">
      <path stroke-linecap="round" stroke-linejoin="round" d={icon} />
    </svg>
  </button>
{/snippet}
