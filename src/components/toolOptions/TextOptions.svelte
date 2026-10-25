<script lang="ts">
  import {
    selectedTextId,
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
  import { editorStore, activeDocument, type PlacedText, type TextAlign, type TextFontFamily } from '../../stores/editor';
  import PanelHeader from './PanelHeader.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  type TextStyle = Pick<
    PlacedText,
    'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'underline' | 'color' | 'letterSpacing' | 'align'
  >;

  // The box selected on the page, if it's on the page on screen.
  const selected = $derived(
    $activeDocument?.texts.find((t) => t.id === $selectedTextId && t.page === $activeDocument?.pageNumber),
  );

  const style: TextStyle = $derived(
    selected ?? {
      fontFamily: $defaultTextFontFamily,
      fontSize: $defaultTextFontSize,
      bold: $defaultTextBold,
      italic: $defaultTextItalic,
      underline: $defaultTextUnderline,
      color: $defaultTextColor,
      letterSpacing: $defaultTextLetterSpacing,
      align: $defaultTextAlign,
    },
  );

  // Edits apply to the selected box and always become the style for the next
  // box placed, so the next box matches the last one styled.
  function setStyle(partial: Partial<TextStyle>) {
    if (selected) editorStore.updateText(selected.id, partial);
    if (partial.fontFamily !== undefined) defaultTextFontFamily.set(partial.fontFamily);
    if (partial.fontSize !== undefined) defaultTextFontSize.set(partial.fontSize);
    if (partial.bold !== undefined) defaultTextBold.set(partial.bold);
    if (partial.italic !== undefined) defaultTextItalic.set(partial.italic);
    if (partial.underline !== undefined) defaultTextUnderline.set(partial.underline);
    if (partial.color !== undefined) defaultTextColor.set(partial.color);
    if (partial.letterSpacing !== undefined) defaultTextLetterSpacing.set(partial.letterSpacing);
    if (partial.align !== undefined) defaultTextAlign.set(partial.align);
  }

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
    {#if selected}
      Styling the selected text box. New boxes will use the same style.
    {:else}
      Click on the page to place a text box. New boxes use the style below; select a box to restyle it.
    {/if}
  </p>

  <div
    class="mt-4 truncate rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700"
    style:font-family={FONT_FAMILY_CSS[style.fontFamily]}
    style:font-size="{Math.min(style.fontSize, 28)}px"
    style:font-weight={style.bold ? 'bold' : 'normal'}
    style:font-style={style.italic ? 'italic' : 'normal'}
    style:text-decoration={style.underline ? 'underline' : 'none'}
    style:color={style.color}
    style:letter-spacing="{style.letterSpacing}px"
    style:text-align={style.align}
  >
    {selected?.text.trim() || 'Sample text'}
  </div>

  <div class="mt-4 flex flex-col gap-3 text-xs text-neutral-600 dark:text-neutral-300">
    <label class="flex items-center justify-between gap-2">
      <span>Font</span>
      <select
        class="w-40 rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-xs focus:outline-none
          focus:ring-1 focus:ring-blue-400 dark:border-neutral-700 dark:bg-neutral-900"
        value={style.fontFamily}
        onchange={(e) => setStyle({ fontFamily: (e.target as HTMLSelectElement).value as TextFontFamily })}
      >
        {#each Object.entries(FONT_FAMILY_LABELS) as [value, label] (value)}
          <option {value}>{label}</option>
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
        value={Math.round(style.fontSize)}
        onchange={(e) =>
          setStyle({
            fontSize: clamp(Number((e.target as HTMLInputElement).value) || 18, TEXT_FONT_SIZE_MIN, TEXT_FONT_SIZE_MAX),
          })}
        onwheel={(e) => {
          e.preventDefault();
          setStyle({ fontSize: clamp(Math.round(style.fontSize) + (e.deltaY < 0 ? 1 : -1), TEXT_FONT_SIZE_MIN, TEXT_FONT_SIZE_MAX) });
        }}
      />
    </label>

    <div class="flex items-center justify-between gap-2">
      <span>Style</span>
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          aria-label="Bold"
          aria-pressed={style.bold}
          class="{toggleClass(style.bold)} font-bold"
          onclick={() => setStyle({ bold: !style.bold })}>B</button
        >
        <button
          type="button"
          aria-label="Italic"
          aria-pressed={style.italic}
          class="{toggleClass(style.italic)} italic"
          onclick={() => setStyle({ italic: !style.italic })}>I</button
        >
        <button
          type="button"
          aria-label="Underline"
          aria-pressed={style.underline}
          class="{toggleClass(style.underline)} underline"
          onclick={() => setStyle({ underline: !style.underline })}>U</button
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
            aria-pressed={style.align === opt.value}
            class={toggleClass(style.align === opt.value)}
            onclick={() => setStyle({ align: opt.value })}
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
        value={style.color}
        onchange={(e) => setStyle({ color: (e.target as HTMLInputElement).value })}
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
        value={style.letterSpacing}
        oninput={(e) => setStyle({ letterSpacing: Number((e.target as HTMLInputElement).value) })}
      />
    </label>
  </div>
</div>
