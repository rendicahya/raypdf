<script lang="ts">
  import { tick } from 'svelte';
  import { editorStore, activeDocument } from '../../stores/editor';
  import { lastHeaderFooterStyle } from '../../stores/pageNumbersTool';
  import { FONT_FAMILY_CSS } from '../../stores/textTool';
  import {
    HEADER_FOOTER_FIELDS,
    hasHeaderFooterText,
    type HeaderFooterLine,
    type HeaderFooterSettings,
  } from '../../lib/pdf/headerFooter';
  import type { PageNumberFont } from '../../lib/pdf/pageNumbers';
  import { wheelRange } from '../../lib/utils/wheelRange';

  // The Header & footer tab of PageTextOptions. The text lives on the
  // document; with every slot empty there's no header or footer at all.

  type LineKey = 'header' | 'footer';

  const pageCount = $derived($activeDocument?.pageCount ?? 1);
  const current = $derived($activeDocument?.headerFooter ?? null);
  const settings = $derived<HeaderFooterSettings>(
    current ?? { header: ['', '', ''], footer: ['', '', ''], fromPage: 1, ...$lastHeaderFooterStyle },
  );
  const numbers = $derived($activeDocument?.pageNumbers ?? null);

  function set(partial: Partial<HeaderFooterSettings>) {
    const next = { ...settings, ...partial };
    editorStore.setHeaderFooter(hasHeaderFooterText(next) ? next : null);
    const { font, fontSize, margin, color } = next;
    lastHeaderFooterStyle.set({ font, fontSize, margin, color });
  }

  function setSlot(line: LineKey, index: number, text: string) {
    const next = [...settings[line]] as HeaderFooterLine;
    next[index] = text;
    set({ [line]: next });
  }

  const inputs: Record<LineKey, HTMLInputElement[]> = { header: [], footer: [] };
  // The slot a field button types into: the one last focused.
  let target = $state<{ line: LineKey; index: number }>({ line: 'footer', index: 0 });

  async function insertField(token: string) {
    const { line, index } = target;
    const input = inputs[line][index];
    const text = settings[line][index];
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? text.length;
    setSlot(line, index, text.slice(0, start) + token + text.slice(end));
    await tick();
    input?.focus();
    input?.setSelectionRange(start + token.length, start + token.length);
  }

  const SLOTS = ['Left', 'Center', 'Right'];
  const LINES: { key: LineKey; label: string; vertical: 'top' | 'bottom' }[] = [
    { key: 'header', label: 'Header', vertical: 'top' },
    { key: 'footer', label: 'Footer', vertical: 'bottom' },
  ];

  // A slot that page numbers also use, where the two would overlap.
  const clash = $derived.by(() => {
    if (!numbers) return null;
    const [vertical, horizontal] = numbers.position.split('-');
    const line = LINES.find((l) => l.vertical === vertical)!;
    const index = ['left', 'center', 'right'].indexOf(horizontal);
    return settings[line.key][index].trim() ? `${line.label.toLowerCase()} ${SLOTS[index].toLowerCase()}` : null;
  });

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
  <p class="text-xs text-neutral-500 dark:text-neutral-400">
    {current
      ? 'The text shows on the pages and is added when you save or print.'
      : 'Type into any spot below to add text along the top or bottom of every page.'}
  </p>

  <div class="mt-4 flex flex-col gap-4 text-xs text-neutral-600 dark:text-neutral-300">
    {#each LINES as line (line.key)}
      <fieldset class="flex flex-col gap-1.5">
        <legend class="mb-1.5 font-medium text-neutral-800 dark:text-neutral-100">{line.label}</legend>
        {#each SLOTS as slot, i (slot)}
          <label class="flex items-center gap-2">
            <span class="w-12 shrink-0">{slot}</span>
            <input
              bind:this={inputs[line.key][i]}
              type="text"
              class="min-w-0 flex-1 {fieldClass}"
              style:text-align={i === 0 ? 'left' : i === 1 ? 'center' : 'right'}
              value={settings[line.key][i]}
              onfocus={() => (target = { line: line.key, index: i })}
              oninput={(e) => setSlot(line.key, i, (e.target as HTMLInputElement).value)}
            />
          </label>
        {/each}
      </fieldset>
    {/each}

    <div>
      <p>Insert into {target.line} {SLOTS[target.index].toLowerCase()}:</p>
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        {#each HEADER_FOOTER_FIELDS as field (field.token)}
          <button
            type="button"
            class="rounded-md border border-neutral-200 px-2 py-0.5 transition-colors hover:border-teal-400
              hover:bg-teal-50 dark:border-neutral-700 dark:hover:bg-teal-950"
            onpointerdown={(e) => e.preventDefault()}
            onclick={() => insertField(field.token)}
          >
            {field.label}
          </button>
        {/each}
      </div>
      <p class="mt-1.5 text-neutral-400">
        For example "Page &lbrace;page&rbrace; of &lbrace;pages&rbrace;" or "&lbrace;file&rbrace;, &lbrace;date&rbrace;".
      </p>
    </div>

    {#if clash}
      <p class="rounded-md bg-amber-50 px-2 py-1.5 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
        The page numbers are also in the {clash}, so the two overlap. Move one of them.
      </p>
    {/if}

    <div class="flex flex-col gap-4" class:opacity-60={!current}>
      <label class="flex items-center justify-between gap-2">
        <span>First page with text</span>
        <input
          type="number"
          min="1"
          max={pageCount}
          class="w-20 {fieldClass}"
          value={settings.fromPage}
          onchange={(e) => set({ fromPage: clamp(Math.round(valueOf(e)) || 1, 1, pageCount) })}
        />
      </label>

      <label class="flex items-center justify-between gap-2">
        <span>Font</span>
        <select
          class="w-40 {fieldClass}"
          style:font-family={FONT_FAMILY_CSS[settings.font]}
          value={settings.font}
          onchange={(e) => set({ font: (e.target as HTMLSelectElement).value as PageNumberFont })}
        >
          {#each FONTS as font (font.value)}
            <option value={font.value}>{font.label}</option>
          {/each}
        </select>
      </label>

      {@render slider('Size', settings.fontSize, 6, 36, `${settings.fontSize}pt`, (v) => set({ fontSize: v }))}
      {@render slider('Distance from edge', settings.margin, 6, 96, `${settings.margin}pt`, (v) =>
        set({ margin: v }),
      )}

      <label class="flex items-center justify-between gap-2">
        <span>Color</span>
        <input
          type="color"
          class="h-7 w-10 cursor-pointer rounded border border-neutral-300 bg-transparent p-0 dark:border-neutral-600"
          value={settings.color}
          onchange={(e) => set({ color: (e.target as HTMLInputElement).value })}
        />
      </label>
    </div>

    {#if current}
      <button
        type="button"
        class="self-start rounded-md border border-neutral-200 px-2.5 py-1 transition-colors hover:border-red-300
          hover:bg-red-50 hover:text-red-700 dark:border-neutral-700 dark:hover:bg-red-950 dark:hover:text-red-300"
        onclick={() => editorStore.setHeaderFooter(null)}
      >
        Remove header and footer
      </button>
    {/if}
  </div>
</div>
