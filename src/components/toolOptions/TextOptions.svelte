<script lang="ts">
  import {
    selectedTextId,
    defaultTextFontFamily,
    defaultTextFontSize,
    defaultTextBold,
    defaultTextItalic,
    defaultTextUnderline,
    defaultTextStrikethrough,
    defaultTextColor,
    defaultTextBackground,
    defaultTextOpacity,
    defaultTextLetterSpacing,
    defaultTextWordSpacing,
    defaultTextLineHeight,
    defaultTextScript,
    defaultTextAlign,
    FONT_FAMILY_LABELS,
    FONT_FAMILY_CSS,
    TEXT_FONT_SIZE_MIN,
    TEXT_FONT_SIZE_MAX,
    TEXT_LETTER_SPACING_MIN,
    TEXT_LETTER_SPACING_MAX,
    TEXT_WORD_SPACING_MIN,
    TEXT_WORD_SPACING_MAX,
    TEXT_LINE_HEIGHT_MIN,
    TEXT_LINE_HEIGHT_MAX,
    TEXT_OPACITY_MIN,
    SCRIPT_SCALE,
    SCRIPT_SHIFT,
    textDecoration,
  } from '../../stores/textTool';
  import {
    editorStore,
    activeDocument,
    type PlacedText,
    type TextAlign,
    type TextFontFamily,
    type TextScript,
  } from '../../stores/editor';
  import { tooltip } from '../../lib/utils/tooltip';
  import { wheelRange } from '../../lib/utils/wheelRange';
  import PanelHeader from './PanelHeader.svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  type TextStyle = Pick<
    PlacedText,
    | 'fontFamily'
    | 'fontSize'
    | 'bold'
    | 'italic'
    | 'underline'
    | 'strikethrough'
    | 'color'
    | 'background'
    | 'opacity'
    | 'letterSpacing'
    | 'wordSpacing'
    | 'lineHeight'
    | 'script'
    | 'align'
  >;

  // The box selected on the page, if it's on the page on screen.
  const selected = $derived(
    $activeDocument?.texts.find((t) => t.id === $selectedTextId),
  );

  const style: TextStyle = $derived(
    selected ?? {
      fontFamily: $defaultTextFontFamily,
      fontSize: $defaultTextFontSize,
      bold: $defaultTextBold,
      italic: $defaultTextItalic,
      underline: $defaultTextUnderline,
      strikethrough: $defaultTextStrikethrough,
      color: $defaultTextColor,
      background: $defaultTextBackground,
      opacity: $defaultTextOpacity,
      letterSpacing: $defaultTextLetterSpacing,
      wordSpacing: $defaultTextWordSpacing,
      lineHeight: $defaultTextLineHeight,
      script: $defaultTextScript,
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
    if (partial.strikethrough !== undefined) defaultTextStrikethrough.set(partial.strikethrough);
    if (partial.color !== undefined) defaultTextColor.set(partial.color);
    if (partial.background !== undefined) defaultTextBackground.set(partial.background);
    if (partial.opacity !== undefined) defaultTextOpacity.set(partial.opacity);
    if (partial.letterSpacing !== undefined) defaultTextLetterSpacing.set(partial.letterSpacing);
    if (partial.wordSpacing !== undefined) defaultTextWordSpacing.set(partial.wordSpacing);
    if (partial.lineHeight !== undefined) defaultTextLineHeight.set(partial.lineHeight);
    if (partial.script !== undefined) defaultTextScript.set(partial.script);
    if (partial.align !== undefined) defaultTextAlign.set(partial.align);
  }

  // The last background color picked, so turning the background off and on
  // again brings it back.
  let lastBackground = $state('#ffffff');
  $effect(() => {
    if (style.background) lastBackground = style.background;
  });

  const ALIGN_OPTIONS: { value: TextAlign; d: string }[] = [
    { value: 'left', d: 'M4 6h16M4 12h10M4 18h14' },
    { value: 'center', d: 'M4 6h16M7 12h10M5 18h14' },
    { value: 'right', d: 'M4 6h16M10 12h10M6 18h14' },
  ];

  const SCRIPT_OPTIONS: { value: TextScript; label: string }[] = [
    { value: 'superscript', label: 'Superscript' },
    { value: 'subscript', label: 'Subscript' },
  ];

  const toggleClass = (on: boolean) =>
    'flex h-7 w-7 items-center justify-center rounded-md text-sm ' +
    (on
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400'
      : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800');

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const valueOf = (e: Event) => Number((e.target as HTMLInputElement).value);
</script>

{#snippet slider(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  shown: string,
  onValue: (v: number) => void,
)}
  <label class="flex items-center justify-between gap-2">
    <span>{label}</span>
    <span class="flex items-center gap-2">
      <input
        type="range"
        {min}
        {max}
        {step}
        class="w-28 accent-blue-600"
        {value}
        use:wheelRange
        oninput={(e) => onValue(valueOf(e))}
      />
      <span class="w-9 text-right tabular-nums text-neutral-400">{shown}</span>
    </span>
  </label>
{/snippet}

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
    style:color={style.color}
    style:background-color={style.background}
    style:opacity={style.opacity}
    style:letter-spacing="{style.letterSpacing}px"
    style:word-spacing="{style.wordSpacing}px"
    style:text-align={style.align}
  >
    <span
      class="relative"
      style:font-size={style.script === 'normal' ? null : `${SCRIPT_SCALE}em`}
      style:top="{SCRIPT_SHIFT[style.script] * Math.min(style.fontSize, 28)}px"
      style:text-decoration-line={textDecoration(style)}>{selected?.text.trim() || 'Sample text'}</span
    >
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
            fontSize: clamp(valueOf(e) || 18, TEXT_FONT_SIZE_MIN, TEXT_FONT_SIZE_MAX),
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
          use:tooltip={'Bold'}
          class="{toggleClass(style.bold)} font-bold"
          onclick={() => setStyle({ bold: !style.bold })}>B</button
        >
        <button
          type="button"
          aria-label="Italic"
          aria-pressed={style.italic}
          use:tooltip={'Italic'}
          class="{toggleClass(style.italic)} italic"
          onclick={() => setStyle({ italic: !style.italic })}>I</button
        >
        <button
          type="button"
          aria-label="Underline"
          aria-pressed={style.underline}
          use:tooltip={'Underline'}
          class="{toggleClass(style.underline)} underline"
          onclick={() => setStyle({ underline: !style.underline })}>U</button
        >
        <button
          type="button"
          aria-label="Strikethrough"
          aria-pressed={style.strikethrough}
          use:tooltip={'Strikethrough'}
          class="{toggleClass(style.strikethrough)} line-through"
          onclick={() => setStyle({ strikethrough: !style.strikethrough })}>S</button
        >
        {#each SCRIPT_OPTIONS as opt (opt.value)}
          <button
            type="button"
            aria-label={opt.label}
            aria-pressed={style.script === opt.value}
            use:tooltip={`${opt.label} (the whole box)`}
            class={toggleClass(style.script === opt.value)}
            onclick={() => setStyle({ script: style.script === opt.value ? 'normal' : opt.value })}
          >
            x<span class="text-[0.6rem] {opt.value === 'superscript' ? '-translate-y-1' : 'translate-y-1'}">2</span>
          </button>
        {/each}
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
            use:tooltip={`Align ${opt.value}`}
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

    <div class="flex items-center justify-between gap-2">
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          class="h-3.5 w-3.5 rounded border-neutral-300 text-blue-600 focus:ring-blue-500 dark:border-neutral-600"
          checked={style.background !== null}
          onchange={(e) => setStyle({ background: (e.target as HTMLInputElement).checked ? lastBackground : null })}
        />
        <span>Background</span>
      </label>
      <input
        type="color"
        aria-label="Background color"
        class="h-7 w-10 cursor-pointer rounded border border-neutral-300 bg-transparent p-0 disabled:cursor-not-allowed
          disabled:opacity-40 dark:border-neutral-600"
        value={style.background ?? lastBackground}
        disabled={style.background === null}
        onchange={(e) => setStyle({ background: (e.target as HTMLInputElement).value })}
      />
    </div>

    {@render slider(
      'Letter spacing',
      style.letterSpacing,
      TEXT_LETTER_SPACING_MIN,
      TEXT_LETTER_SPACING_MAX,
      0.5,
      `${style.letterSpacing}`,
      (v) => setStyle({ letterSpacing: v }),
    )}
    {@render slider(
      'Word spacing',
      style.wordSpacing,
      TEXT_WORD_SPACING_MIN,
      TEXT_WORD_SPACING_MAX,
      1,
      `${Math.round(style.wordSpacing)}`,
      (v) => setStyle({ wordSpacing: v }),
    )}
    {@render slider(
      'Line spacing',
      style.lineHeight,
      TEXT_LINE_HEIGHT_MIN,
      TEXT_LINE_HEIGHT_MAX,
      0.1,
      style.lineHeight.toFixed(1),
      (v) => setStyle({ lineHeight: v }),
    )}
    {@render slider(
      'Opacity',
      style.opacity,
      TEXT_OPACITY_MIN,
      1,
      0.05,
      `${Math.round(style.opacity * 100)}%`,
      (v) => setStyle({ opacity: v }),
    )}
  </div>
</div>
