<script lang="ts">
  import { editorStore, activeDocument } from '../../stores/editor';
  import { imagePropertiesId } from '../../stores/toolPanel';
  import { addImageFile, imageFor, IMAGE_ACCEPT } from '../../stores/images';
  import { wheelRange } from '../../lib/utils/wheelRange';
  import PanelHeader from './PanelHeader.svelte';

  // The properties of one placed image (imagePropertiesId): its size, opacity,
  // and the picture itself. Every change is undoable, like a drag.

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const scale = $derived($editorStore.renderScale);
  const image = $derived($activeDocument?.images.find((i) => i.id === $imagePropertiesId) ?? null);
  const stored = $derived(image ? imageFor(image.imageId) : undefined);

  // Removed (deleted, undone, another document): nothing left to show.
  $effect(() => {
    if (!image) onClose();
  });

  // Sizes are shown in PDF points; images store them in canvas pixels.
  const MIN_SIZE = 16;
  const toPoints = (px: number) => Math.round((px / scale) * 10) / 10;
  const widthPt = $derived(image ? toPoints(image.width) : 0);
  const heightPt = $derived(image ? toPoints(image.height) : 0);

  // Proportions are always kept, as when resizing on the page.
  function resize(value: number, side: 'width' | 'height') {
    if (!image || !Number.isFinite(value) || value <= 0) return;
    const aspect = image.width / image.height;
    const px = value * scale;
    const width = side === 'width' ? px : px * aspect;
    const height = side === 'width' ? px / aspect : px;
    if (Math.max(width, height) < MIN_SIZE) return;
    editorStore.updateImage(image.id, { width, height });
  }

  let replaceInput = $state<HTMLInputElement | undefined>();
  let replaceError = $state<string | null>(null);

  // A new picture in the same place: as wide as the old one, as tall as its
  // own proportions make it, centred where the old one was.
  async function replace(file: File) {
    if (!image) return;
    replaceError = null;
    try {
      const added = await addImageFile(file);
      const height = image.width * (added.height / added.width);
      editorStore.updateImage(image.id, {
        imageId: added.id,
        height,
        y: Math.max(0, image.y + (image.height - height) / 2),
      });
    } catch (err) {
      replaceError = err instanceof Error ? err.message : 'Failed to read the image';
    }
  }

  const valueOf = (e: Event) => Number((e.target as HTMLInputElement).value);
</script>

<div>
  <PanelHeader title="Image" {onClose} />

  {#if image}
    <div
      class="flex h-36 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 p-2
        dark:border-neutral-700 dark:bg-neutral-900"
    >
      {#if stored}
        <img src={stored.url} alt="" class="max-h-full max-w-full object-contain" style:opacity={image.opacity} />
      {/if}
    </div>
    {#if stored}
      <p class="mt-1 text-center text-xs text-neutral-400">{stored.width} × {stored.height} pixels</p>
    {/if}

    <div class="mt-4 flex flex-col gap-4 text-xs text-neutral-600 dark:text-neutral-300">
      <div class="flex items-center justify-between gap-2">
        <span>Size</span>
        <span class="flex items-center gap-1">
          <input
            type="number"
            aria-label="Width in points"
            min="1"
            step="1"
            class="w-16 rounded border border-neutral-300 bg-transparent px-1.5 py-1 text-right tabular-nums
              dark:border-neutral-600"
            value={widthPt}
            oninput={(e) => resize(valueOf(e), 'width')}
          />
          <span class="text-neutral-400">×</span>
          <input
            type="number"
            aria-label="Height in points"
            min="1"
            step="1"
            class="w-16 rounded border border-neutral-300 bg-transparent px-1.5 py-1 text-right tabular-nums
              dark:border-neutral-600"
            value={heightPt}
            oninput={(e) => resize(valueOf(e), 'height')}
          />
          <span class="text-neutral-400">pt</span>
        </span>
      </div>
      <p class="-mt-2 text-neutral-400">Width and height keep the picture's proportions.</p>

      <label class="flex items-center justify-between gap-2">
        <span>Opacity</span>
        <span class="flex items-center gap-2">
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            class="w-28 accent-fuchsia-600"
            value={Math.round(image.opacity * 100)}
            use:wheelRange
            oninput={(e) => editorStore.updateImage(image.id, { opacity: valueOf(e) / 100 })}
          />
          <span class="w-9 text-right tabular-nums text-neutral-400">{Math.round(image.opacity * 100)}%</span>
        </span>
      </label>

      <div class="flex flex-col gap-1">
        <button
          type="button"
          class="rounded-lg border border-neutral-200 px-3 py-2 font-medium transition-colors hover:bg-neutral-100
            dark:border-neutral-700 dark:hover:bg-neutral-800"
          onclick={() => replaceInput?.click()}
        >
          Replace image…
        </button>
        <input
          bind:this={replaceInput}
          type="file"
          accept={IMAGE_ACCEPT}
          class="hidden"
          onchange={(e) => {
            const input = e.target as HTMLInputElement;
            const file = input.files?.[0];
            input.value = '';
            if (file) void replace(file);
          }}
        />
        {#if replaceError}
          <p class="text-red-600 dark:text-red-400">{replaceError}</p>
        {/if}
      </div>
    </div>
  {/if}
</div>
