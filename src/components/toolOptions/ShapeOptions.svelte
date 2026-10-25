<script lang="ts">
  import { editorStore, activeDocument, type PlacedShape, type ShapeKind } from '../../stores/editor';
  import {
    selectedShapeId,
    shapeKind,
    shapeStroke,
    shapeStrokeWidth,
    shapeFill,
    shapeOpacity,
  } from '../../stores/shapeTool';
  import { wheelRange } from '../../lib/utils/wheelRange';
  import { tooltip } from '../../lib/utils/tooltip';
  import PanelHeader from './PanelHeader.svelte';

  // Restyles the selected shape, or sets the style for new ones when none is
  // selected. Either way the choice becomes the style for the next shape.

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const scale = $derived($editorStore.renderScale);
  const selected = $derived($activeDocument?.shapes.find((s) => s.id === $selectedShapeId) ?? null);

  // Widths are shown in PDF points; shapes store them in canvas pixels.
  const style = $derived(
    selected
      ? {
          kind: selected.kind,
          stroke: selected.stroke,
          strokeWidth: Math.round((selected.strokeWidth / scale) * 2) / 2,
          fill: selected.fill,
          opacity: selected.opacity,
        }
      : { kind: $shapeKind, stroke: $shapeStroke, strokeWidth: $shapeStrokeWidth, fill: $shapeFill, opacity: $shapeOpacity },
  );
  const isLine = $derived(style.kind === 'line' || style.kind === 'arrow');

  type Style = typeof style;

  function set(partial: Partial<Style>) {
    if (partial.kind !== undefined) $shapeKind = partial.kind;
    if (partial.stroke !== undefined) $shapeStroke = partial.stroke;
    if (partial.strokeWidth !== undefined) $shapeStrokeWidth = partial.strokeWidth;
    if (partial.fill !== undefined) $shapeFill = partial.fill;
    if (partial.opacity !== undefined) $shapeOpacity = partial.opacity;
    if (!selected) return;
    const { strokeWidth, ...rest } = partial;
    const change: Partial<PlacedShape> = { ...rest };
    if (strokeWidth !== undefined) change.strokeWidth = strokeWidth * scale;
    // A line needs some thickness to be seen at all.
    const nextKind = partial.kind ?? selected.kind;
    if ((nextKind === 'line' || nextKind === 'arrow') && (change.strokeWidth ?? selected.strokeWidth) <= 0) {
      change.strokeWidth = Math.max(1, $shapeStrokeWidth) * scale;
    }
    editorStore.updateShape(selected.id, change);
  }

  const KINDS: { value: ShapeKind; label: string; icon: string }[] = [
    { value: 'rectangle', label: 'Rectangle', icon: 'M4 6h16v12H4z' },
    { value: 'ellipse', label: 'Ellipse', icon: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z' },
    { value: 'line', label: 'Line', icon: 'M5 19L19 5' },
    { value: 'arrow', label: 'Arrow', icon: 'M5 19L19 5M10 5h9v9' },
  ];

  const valueOf = (e: Event) => Number((e.target as HTMLInputElement).value);
</script>

<div>
  <PanelHeader title="Shapes" {onClose} />

  <p class="text-xs text-neutral-500 dark:text-neutral-400">
    {selected
      ? 'Changes apply to the selected shape, and to the next one you draw.'
      : 'Drag on the page to draw. Hold Shift for a square, a circle, or a straight line.'}
  </p>

  <div class="mt-4 flex flex-col gap-4 text-xs text-neutral-600 dark:text-neutral-300">
    <div class="flex items-center justify-between gap-2">
      <span>Shape</span>
      <div class="flex gap-1">
        {#each KINDS as kind (kind.value)}
          <button
            type="button"
            aria-label={kind.label}
            aria-pressed={style.kind === kind.value}
            use:tooltip={kind.label}
            class="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors {style.kind === kind.value
              ? 'border-fuchsia-600 bg-fuchsia-600 text-white'
              : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'}"
            onclick={() => set({ kind: kind.value })}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
              <path stroke-linecap="round" stroke-linejoin="round" d={kind.icon} />
            </svg>
          </button>
        {/each}
      </div>
    </div>

    <label class="flex items-center justify-between gap-2">
      <span>{isLine ? 'Color' : 'Outline'}</span>
      <input
        type="color"
        class="h-7 w-10 cursor-pointer rounded border border-neutral-300 bg-transparent p-0 dark:border-neutral-600"
        value={style.stroke}
        oninput={(e) => set({ stroke: (e.target as HTMLInputElement).value })}
      />
    </label>

    <label class="flex items-center justify-between gap-2">
      <span>{isLine ? 'Thickness' : 'Outline width'}</span>
      <span class="flex items-center gap-2">
        <input
          type="range"
          min={isLine ? 1 : 0}
          max="20"
          step="0.5"
          class="w-28 accent-fuchsia-600"
          value={style.strokeWidth}
          use:wheelRange
          oninput={(e) => set({ strokeWidth: valueOf(e) })}
        />
        <span class="w-9 text-right tabular-nums text-neutral-400">
          {style.strokeWidth === 0 ? 'None' : `${style.strokeWidth}pt`}
        </span>
      </span>
    </label>

    {#if !isLine}
      <div class="flex items-center justify-between gap-2">
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            class="h-3.5 w-3.5 rounded border-neutral-300 text-fuchsia-600 focus:ring-fuchsia-500 dark:border-neutral-600"
            checked={style.fill !== null}
            onchange={(e) => set({ fill: (e.target as HTMLInputElement).checked ? ($shapeFill ?? '#fde68a') : null })}
          />
          Fill
        </label>
        {#if style.fill !== null}
          <input
            type="color"
            aria-label="Fill color"
            class="h-7 w-10 cursor-pointer rounded border border-neutral-300 bg-transparent p-0 dark:border-neutral-600"
            value={style.fill}
            oninput={(e) => set({ fill: (e.target as HTMLInputElement).value })}
          />
        {/if}
      </div>
    {/if}

    <label class="flex items-center justify-between gap-2">
      <span>Opacity</span>
      <span class="flex items-center gap-2">
        <input
          type="range"
          min="10"
          max="100"
          step="5"
          class="w-28 accent-fuchsia-600"
          value={Math.round(style.opacity * 100)}
          use:wheelRange
          oninput={(e) => set({ opacity: valueOf(e) / 100 })}
        />
        <span class="w-9 text-right tabular-nums text-neutral-400">{Math.round(style.opacity * 100)}%</span>
      </span>
    </label>
  </div>
</div>
