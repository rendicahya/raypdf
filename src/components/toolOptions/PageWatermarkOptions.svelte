<script lang="ts">
  import { editorStore, activeDocument } from '../../stores/editor';
  import { lastPageWatermarkStyle, lastPageWatermarkImage } from '../../stores/pageWatermarkTool';
  import { addImageFile, imageFor, IMAGE_ACCEPT } from '../../stores/images';
  import { FONT_FAMILY_CSS } from '../../stores/textTool';
  import {
    DEFAULT_PAGE_WATERMARK,
    hasWatermarkContent,
    type PageWatermarkSettings,
  } from '../../lib/pdf/pageWatermark';
  import type { PageNumberFont } from '../../lib/pdf/pageNumbers';
  import { wheelRange } from '../../lib/utils/wheelRange';
  import PanelHeader from './PanelHeader.svelte';

  // The Watermark tool's panel. The watermark lives on the document; any
  // change here puts it on the pages, as long as there's text or a picture.

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const current = $derived($activeDocument?.pageWatermark ?? null);
  const settings = $derived<PageWatermarkSettings>(
    current ?? { ...DEFAULT_PAGE_WATERMARK, ...$lastPageWatermarkStyle, imageId: $lastPageWatermarkImage },
  );
  const image = $derived(settings.imageId ? imageFor(settings.imageId) : undefined);
  const canAdd = $derived(hasWatermarkContent(settings, imageFor));

  function set(partial: Partial<PageWatermarkSettings>) {
    const next = { ...settings, ...partial };
    editorStore.setPageWatermark(hasWatermarkContent(next, imageFor) ? next : null);
    const { imageId, ...style } = next;
    lastPageWatermarkStyle.set(style);
    if (imageId) lastPageWatermarkImage.set(imageId);
  }

  let imageError: string | null = $state(null);

  async function onImagePicked(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      imageError = null;
      const { id } = await addImageFile(file);
      set({ kind: 'image', imageId: id });
    } catch (err) {
      imageError = err instanceof Error ? err.message : 'Failed to add the image';
    }
  }

  const KINDS = [
    { value: 'text', label: 'Text' },
    { value: 'image', label: 'Image' },
  ] as const;

  const LAYOUTS = [
    { value: 'center', label: 'Once, in the middle' },
    { value: 'tile', label: 'Tiled' },
  ] as const;

  const FONTS: { value: PageNumberFont; label: string }[] = [
    { value: 'helvetica', label: 'Helvetica' },
    { value: 'times', label: 'Times' },
    { value: 'courier', label: 'Courier' },
  ];

  const ANGLES = [-45, 0, 45, 90];

  const valueOf = (e: Event) => Number((e.target as HTMLInputElement).value);

  const fieldClass =
    'rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-xs focus:outline-none ' +
    'focus:ring-1 focus:ring-amber-400 dark:border-neutral-700 dark:bg-neutral-900';
  const chipClass = (on: boolean) =>
    'rounded-md px-2 py-1 font-medium transition-colors ' +
    (on
      ? 'bg-white text-amber-700 shadow-sm dark:bg-neutral-900 dark:text-amber-300'
      : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200');
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
      <input type="range" {min} {max} step="1" class="w-28 accent-amber-600" {value} use:wheelRange
        oninput={(e) => onValue(valueOf(e))} />
      <span class="w-10 text-right tabular-nums text-neutral-400">{shown}</span>
    </span>
  </label>
{/snippet}

<div>
  <PanelHeader title="Watermark" {onClose} />

  <p class="text-xs text-neutral-500 dark:text-neutral-400">
    {current
      ? 'The watermark shows on every page and is added when you save or print.'
      : 'Stamp a word or a picture, such as CONFIDENTIAL or a logo, across every page.'}
  </p>

  <div class="mt-4 flex flex-col gap-4 text-xs text-neutral-600 dark:text-neutral-300">
    <div role="radiogroup" aria-label="Watermark type" class="grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
      {#each KINDS as kind (kind.value)}
        <button
          type="button"
          role="radio"
          aria-checked={settings.kind === kind.value}
          class={chipClass(settings.kind === kind.value)}
          onclick={() => set({ kind: kind.value })}
        >
          {kind.label}
        </button>
      {/each}
    </div>

    {#if settings.kind === 'text'}
      <label class="flex flex-col gap-1.5">
        <span>Text</span>
        <input
          type="text"
          class={fieldClass}
          value={settings.text}
          placeholder="CONFIDENTIAL"
          oninput={(e) => set({ text: (e.target as HTMLInputElement).value })}
        />
      </label>

      <div class="flex items-center justify-between gap-2">
        <span>Font</span>
        <span class="flex items-center gap-1.5">
          <select
            aria-label="Font"
            class="w-28 {fieldClass}"
            style:font-family={FONT_FAMILY_CSS[settings.font]}
            value={settings.font}
            onchange={(e) => set({ font: (e.target as HTMLSelectElement).value as PageNumberFont })}
          >
            {#each FONTS as font (font.value)}
              <option value={font.value}>{font.label}</option>
            {/each}
          </select>
          <button
            type="button"
            aria-label="Bold"
            aria-pressed={settings.bold}
            class="h-7 w-7 rounded-md border font-bold transition-colors {settings.bold
              ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
              : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'}"
            onclick={() => set({ bold: !settings.bold })}
          >
            B
          </button>
        </span>
      </div>

      {@render slider('Size', settings.fontSize, 12, 200, `${settings.fontSize}pt`, (v) => set({ fontSize: v }))}

      <label class="flex items-center justify-between gap-2">
        <span>Color</span>
        <input
          type="color"
          class="h-7 w-10 cursor-pointer rounded border border-neutral-300 bg-transparent p-0 dark:border-neutral-600"
          value={settings.color}
          onchange={(e) => set({ color: (e.target as HTMLInputElement).value })}
        />
      </label>
    {:else}
      <label
        class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed
          border-neutral-300 p-3 text-center transition-colors hover:border-amber-400 hover:bg-amber-50/50
          dark:border-neutral-700 dark:hover:bg-amber-950/30"
      >
        <input type="file" accept={IMAGE_ACCEPT} class="hidden" onchange={onImagePicked} />
        {#if image}
          <img src={image.url} alt="Watermark" class="max-h-24 max-w-full object-contain" />
          <span class="text-neutral-500 dark:text-neutral-400">Choose another image</span>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-6 w-6 text-neutral-400">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="10" r="2" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 16l-5-5-9 9" />
          </svg>
          <span class="font-medium">Choose an image</span>
          <span class="text-neutral-400">A logo or stamp works best, ideally a PNG with a transparent background.</span>
        {/if}
      </label>
      {#if imageError}
        <p class="text-red-600 dark:text-red-400">{imageError}</p>
      {/if}

      {@render slider('Width', Math.round(settings.imageWidth * 100), 5, 100, `${Math.round(settings.imageWidth * 100)}%`, (v) =>
        set({ imageWidth: v / 100 }),
      )}
    {/if}

    <div class="flex flex-col gap-1.5">
      <span>Placement</span>
      <div role="radiogroup" aria-label="Placement" class="grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
        {#each LAYOUTS as layout (layout.value)}
          <button
            type="button"
            role="radio"
            aria-checked={settings.layout === layout.value}
            class={chipClass(settings.layout === layout.value)}
            onclick={() => set({ layout: layout.value })}
          >
            {layout.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      {@render slider('Angle', settings.angle, -90, 90, `${settings.angle}°`, (v) => set({ angle: v }))}
      <div class="flex justify-end gap-1">
        {#each ANGLES as angle (angle)}
          <button
            type="button"
            class="rounded-md border px-1.5 py-0.5 tabular-nums transition-colors {settings.angle === angle
              ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
              : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'}"
            onclick={() => set({ angle })}
          >
            {angle}°
          </button>
        {/each}
      </div>
    </div>

    {@render slider('Opacity', Math.round(settings.opacity * 100), 5, 100, `${Math.round(settings.opacity * 100)}%`, (v) =>
      set({ opacity: v / 100 }),
    )}

    {#if current}
      <button
        type="button"
        class="self-start rounded-md border border-neutral-200 px-2.5 py-1 transition-colors hover:border-red-300
          hover:bg-red-50 hover:text-red-700 dark:border-neutral-700 dark:hover:bg-red-950 dark:hover:text-red-300"
        onclick={() => editorStore.setPageWatermark(null)}
      >
        Remove watermark
      </button>
    {:else}
      <button
        type="button"
        disabled={!canAdd}
        class="rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-amber-700
          disabled:cursor-not-allowed disabled:opacity-40"
        onclick={() => set({})}
      >
        Add watermark
      </button>
    {/if}
  </div>
</div>
