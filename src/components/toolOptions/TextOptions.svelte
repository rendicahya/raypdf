<script lang="ts">
  import {
    defaultTextFontFamily,
    defaultTextFontSize,
    defaultTextBold,
    defaultTextItalic,
    defaultTextUnderline,
    defaultTextColor,
    defaultTextLetterSpacing,
    defaultTextAlign,
    FONT_FAMILY_LABELS,
    FONT_FAMILY_CSS,
    TEXT_FONT_SIZE_MIN,
    TEXT_FONT_SIZE_MAX,
    TEXT_LETTER_SPACING_MIN,
    TEXT_LETTER_SPACING_MAX,
  } from '../../stores/textTool';
  import type { TextAlign, TextFontFamily } from '../../stores/editor';
  import PanelHeader from './PanelHeader.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  // The same styles the floating style bar on a text box sets; editing a box
  // there also updates these, so the next box matches the last one styled.
  const ALIGN_OPTIONS: { value: TextAlign; d: string }[] = [
    { value: 'left', d: 'M4 6h16M4 12h10M4 18h14' },
    { value: 'center', d: 'M4 6h16M7 12h10M5 18h14' },
    { value: 'right', d: 'M4 6h16M10 12h10M6 18h14' },
  ];

  const toggleClass = (on: boolean) =>
    'flex h-7 w-7 items-center justify-center rounded-md text-sm ' +
    (on
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400'
      : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800');

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
</script>

<div>
  <PanelHeader title="Add Text" {onClose} />

  <p class="text-xs text-neutral-500 dark:text-neutral-400">
    Click on the page to place a text box. New boxes use the style below; select a box to restyle just that one.
  </p>

  <div
    class="mt-4 truncate rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700"
    style:font-family={FONT_FAMILY_CSS[$defaultTextFontFamily]}
    style:font-size="{Math.min($defaultTextFontSize, 28)}px"
    style:font-weight={$defaultTextBold ? 'bold' : 'normal'}
    style:font-style={$defaultTextItalic ? 'italic' : 'normal'}
    style:text-decoration={$defaultTextUnderline ? 'underline' : 'none'}
    style:color={$defaultTextColor}
    style:letter-spacing="{$defaultTextLetterSpacing}px"
    style:text-align={$defaultTextAlign}
  >
    Sample text
  </div>

  <div class="mt-4 flex flex-col gap-3 text-xs text-neutral-600 dark:text-neutral-300">
    <label class="flex items-center justify-between gap-2">
      <span>Font</span>
      <select
        class="w-40 rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-xs focus:outline-none
          focus:ring-1 focus:ring-blue-400 dark:border-neutral-700 dark:bg-neutral-900"
        bind:value={$defaultTextFontFamily}
      >
        {#each Object.entries(FONT_FAMILY_LABELS) as [value, label] (value)}
          <option value={value as TextFontFamily}>{label}</option>
        {/each}
      </select>
    </label>

    <label class="flex items-center justify-between gap-2">
      <span>Size</span>
      <input
        type="number"
        min={TEXT_FONT_SIZE_MIN}
        max={TEXT_FONT_SIZE_MAX}
        class="w-20 rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-xs focus:outline-none
          focus:ring-1 focus:ring-blue-400 dark:border-neutral-700"
        value={$defaultTextFontSize}
        onchange={(e) =>
          defaultTextFontSize.set(
            clamp(Number((e.target as HTMLInputElement).value) || 18, TEXT_FONT_SIZE_MIN, TEXT_FONT_SIZE_MAX),
          )}
      />
    </label>

    <div class="flex items-center justify-between gap-2">
      <span>Style</span>
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          aria-label="Bold"
          aria-pressed={$defaultTextBold}
          class="{toggleClass($defaultTextBold)} font-bold"
          onclick={() => defaultTextBold.update((v) => !v)}>B</button
        >
        <button
          type="button"
          aria-label="Italic"
          aria-pressed={$defaultTextItalic}
          class="{toggleClass($defaultTextItalic)} italic"
          onclick={() => defaultTextItalic.update((v) => !v)}>I</button
        >
        <button
          type="button"
          aria-label="Underline"
          aria-pressed={$defaultTextUnderline}
          class="{toggleClass($defaultTextUnderline)} underline"
          onclick={() => defaultTextUnderline.update((v) => !v)}>U</button
        >
      </div>
    </div>

    <div class="flex items-center justify-between gap-2">
      <span>Align</span>
      <div class="flex items-center gap-0.5">
        {#each ALIGN_OPTIONS as opt (opt.value)}
          <button
            type="button"
            aria-label="Align {opt.value}"
            aria-pressed={$defaultTextAlign === opt.value}
            class={toggleClass($defaultTextAlign === opt.value)}
            onclick={() => defaultTextAlign.set(opt.value)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
              <path stroke-linecap="round" d={opt.d} />
            </svg>
          </button>
        {/each}
      </div>
    </div>

    <label class="flex items-center justify-between gap-2">
      <span>Color</span>
      <input
        type="color"
        class="h-7 w-10 cursor-pointer rounded border border-neutral-300 bg-transparent p-0 dark:border-neutral-600"
        bind:value={$defaultTextColor}
      />
    </label>

    <label class="flex items-center justify-between gap-2">
      <span>Letter spacing</span>
      <input
        type="range"
        min={TEXT_LETTER_SPACING_MIN}
        max={TEXT_LETTER_SPACING_MAX}
        step="0.5"
        class="w-32 accent-blue-600"
        bind:value={$defaultTextLetterSpacing}
      />
    </label>
  </div>
</div>
