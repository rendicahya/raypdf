<script lang="ts">
  import { editorStore, activeDocument } from '../../stores/editor';
  import { lastPageNumberStyle } from '../../stores/pageNumbersTool';
  import { FONT_FAMILY_CSS } from '../../stores/textTool';
  import {
    PAGE_NUMBER_FORMATS,
    pageNumberLabel,
    type PageNumberFont,
    type PageNumberFormat,
    type PageNumberPosition,
    type PageNumberSettings,
  } from '../../lib/pdf/pageNumbers';
  import { wheelRange } from '../../lib/utils/wheelRange';
  import PanelHeader from './PanelHeader.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const pageCount = $derived($activeDocument?.pageCount ?? 1);
  const current = $derived($activeDocument?.pageNumbers ?? null);
  const on = $derived(current !== null);
  // While numbering is off, the controls show the last style used, and
  // changing any of them turns numbering on with it.
  const style = $derived(
    current ?? { ...$lastPageNumberStyle, fromPage: Math.min($lastPageNumberStyle.fromPage, pageCount) },
  );

  function setStyle(partial: Partial<PageNumberSettings>) {
    const next = { ...style, ...partial };
    editorStore.setPageNumbers(next);
    lastPageNumberStyle.set(next);
  }

  function setOn(value: boolean) {
    editorStore.setPageNumbers(value ? style : null);
  }

  const POSITIONS: { value: PageNumberPosition; label: string }[] = [
    { value: 'top-left', label: 'Top left' },
    { value: 'top-center', label: 'Top center' },
    { value: 'top-right', label: 'Top right' },
    { value: 'bottom-left', label: 'Bottom left' },
    { value: 'bottom-center', label: 'Bottom center' },
    { value: 'bottom-right', label: 'Bottom right' },
  ];

  const FONTS: { value: PageNumberFont; label: string }[] = [
    { value: 'helvetica', label: 'Helvetica' },
    { value: 'times', label: 'Times' },
    { value: 'courier', label: 'Courier' },
  ];

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const valueOf = (e: Event) => Number((e.target as HTMLInputElement).value);

  const fieldClass =
    'rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-xs focus:outline-none ' +
    'focus:ring-1 focus:ring-teal-400 dark:border-neutral-700 dark:bg-neutral-900';
</script>

{#snippet slider(
  label: string,
  value: number,
  min: number,
  max: number,
  shown: string,
  onValue: (v: number) => void,
)}
  <label class="flex items-center justify-between gap-2">
    <span>{label}</span>
    <span class="flex items-center gap-2">
      <input type="range" {min} {max} step="1" class="w-28 accent-teal-600" {value} use:wheelRange
        oninput={(e) => onValue(valueOf(e))} />
      <span class="w-9 text-right tabular-nums text-neutral-400">{shown}</span>
    </span>
  </label>
{/snippet}

<div>
  <PanelHeader title="Page numbers" {onClose} />

  <label class="flex items-center gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
    <input
      type="checkbox"
      class="h-4 w-4 rounded border-neutral-300 text-teal-600 focus:ring-teal-500 dark:border-neutral-600"
      checked={on}
      onchange={(e) => setOn((e.target as HTMLInputElement).checked)}
    />
    Number the pages
  </label>
  <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
    {on
      ? 'The numbers show on the pages and are added when you save or print.'
      : 'Turn on, or change any option below, to add numbers to this document.'}
  </p>

  <div class="mt-4 flex flex-col gap-4 text-xs text-neutral-600 dark:text-neutral-300" class:opacity-60={!on}>
    <div class="flex items-start justify-between gap-2">
      <span class="pt-1">Position</span>
      <!-- A small page with a spot for each position. -->
      <div
        class="grid h-32 w-24 grid-cols-3 grid-rows-[auto_1fr_auto] rounded border border-neutral-300 bg-white p-1
          dark:border-neutral-600 dark:bg-neutral-900"
      >
        {#each POSITIONS as position, i (position.value)}
          <button
            type="button"
            aria-label={position.label}
            aria-pressed={style.position === position.value}
            class="flex h-5 items-center rounded hover:bg-teal-50 dark:hover:bg-teal-950
              {i % 3 === 0 ? 'justify-start' : i % 3 === 1 ? 'justify-center' : 'justify-end'}
              {i >= 3 ? 'row-start-3' : ''}"
            onclick={() => setStyle({ position: position.value })}
          >
            <span
              class="mx-0.5 h-1.5 w-3 rounded-sm {style.position === position.value && on
                ? 'bg-teal-600'
                : style.position === position.value
                  ? 'bg-neutral-500'
                  : 'bg-neutral-200 dark:bg-neutral-700'}"
            ></span>
          </button>
        {/each}
      </div>
    </div>

    <label class="flex items-center justify-between gap-2">
      <span>Format</span>
      <select
        class="w-40 {fieldClass}"
        value={style.format}
        onchange={(e) => setStyle({ format: (e.target as HTMLSelectElement).value as PageNumberFormat })}
      >
        {#each PAGE_NUMBER_FORMATS as format (format.value)}
          <option value={format.value}>{format.label}</option>
        {/each}
      </select>
    </label>

    <label class="flex items-center justify-between gap-2">
      <span>Start at</span>
      <input
        type="number"
        min="0"
        class="w-20 {fieldClass}"
        value={style.startAt}
        onchange={(e) => setStyle({ startAt: Math.max(0, Math.round(valueOf(e)) || 0) })}
      />
    </label>

    <label class="flex items-center justify-between gap-2">
      <span>First numbered page</span>
      <input
        type="number"
        min="1"
        max={pageCount}
        class="w-20 {fieldClass}"
        value={style.fromPage}
        onchange={(e) => setStyle({ fromPage: clamp(Math.round(valueOf(e)) || 1, 1, pageCount) })}
      />
    </label>
    {#if style.fromPage > 1}
      <p class="-mt-3 text-neutral-400">
        Pages 1{style.fromPage > 2 ? ` to ${style.fromPage - 1}` : ''} stay unnumbered; page {style.fromPage} shows
        "{pageNumberLabel(style, style.fromPage, pageCount)}".
      </p>
    {/if}

    <label class="flex items-center justify-between gap-2">
      <span>Font</span>
      <select
        class="w-40 {fieldClass}"
        style:font-family={FONT_FAMILY_CSS[style.font]}
        value={style.font}
        onchange={(e) => setStyle({ font: (e.target as HTMLSelectElement).value as PageNumberFont })}
      >
        {#each FONTS as font (font.value)}
          <option value={font.value}>{font.label}</option>
        {/each}
      </select>
    </label>

    {@render slider('Size', style.fontSize, 6, 36, `${style.fontSize}pt`, (v) => setStyle({ fontSize: v }))}
    {@render slider('Distance from edge', style.margin, 6, 96, `${style.margin}pt`, (v) => setStyle({ margin: v }))}

    <label class="flex items-center justify-between gap-2">
      <span>Color</span>
      <input
        type="color"
        class="h-7 w-10 cursor-pointer rounded border border-neutral-300 bg-transparent p-0 dark:border-neutral-600"
        value={style.color}
        onchange={(e) => setStyle({ color: (e.target as HTMLInputElement).value })}
      />
    </label>
  </div>
</div>
