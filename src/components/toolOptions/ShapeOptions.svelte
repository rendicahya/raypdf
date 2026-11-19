<script lang="ts">
  import {
    editorStore,
    activeDocument,
    type ArrowHead,
    type LineStyle,
    type PlacedShape,
    type ShapeKind,
  } from '../../stores/editor';
  import {
    selectedShapeId,
    shapeKind,
    shapeStroke,
    shapeStrokeWidth,
    shapeFill,
    shapeOpacity,
    shapeArrowHead,
    shapeLineStyle,
    isLineKind,
    SHAPE_LABELS,
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
          arrowHead: selected.arrowHead ?? 'open',
          lineStyle: selected.lineStyle ?? 'solid',
        }
      : {
          kind: $shapeKind,
          stroke: $shapeStroke,
          strokeWidth: $shapeStrokeWidth,
          fill: $shapeFill,
          opacity: $shapeOpacity,
          arrowHead: $shapeArrowHead,
          lineStyle: $shapeLineStyle,
        },
  );
  const isLine = $derived(isLineKind(style.kind));

  type Style = typeof style;

  function set(partial: Partial<Style>) {
    if (partial.kind !== undefined) $shapeKind = partial.kind;
    if (partial.stroke !== undefined) $shapeStroke = partial.stroke;
    if (partial.strokeWidth !== undefined) $shapeStrokeWidth = partial.strokeWidth;
    if (partial.fill !== undefined) $shapeFill = partial.fill;
    if (partial.opacity !== undefined) $shapeOpacity = partial.opacity;
    if (partial.arrowHead !== undefined) $shapeArrowHead = partial.arrowHead;
    if (partial.lineStyle !== undefined) $shapeLineStyle = partial.lineStyle;
    if (!selected) return;
    const { strokeWidth, ...rest } = partial;
    const change: Partial<PlacedShape> = { ...rest };
    // Turning a shape into an arrow gives it the tip last chosen.
    if (partial.kind === 'arrow' && partial.arrowHead === undefined && !selected.arrowHead) {
      change.arrowHead = $shapeArrowHead;
    }
    if (strokeWidth !== undefined) change.strokeWidth = strokeWidth * scale;
    // A line needs some thickness to be seen at all.
    const nextKind = partial.kind ?? selected.kind;
    if ((nextKind === 'line' || nextKind === 'arrow') && (change.strokeWidth ?? selected.strokeWidth) <= 0) {
      change.strokeWidth = Math.max(1, $shapeStrokeWidth) * scale;
    }
    editorStore.updateShape(selected.id, change);
  }

  const ICONS: Record<ShapeKind, string> = {
    rectangle: 'M4 6h16v12H4z',
    roundedRectangle: 'M7 6h10a3 3 0 013 3v6a3 3 0 01-3 3H7a3 3 0 01-3-3V9a3 3 0 013-3z',
    ellipse: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
    triangle: 'M12 5l8 14H4z',
    rightTriangle: 'M5 5l14 14H5z',
    diamond: 'M12 4l8 8-8 8-8-8z',
    pentagon: 'M12 4l8 6-3 9H7l-3-9z',
    hexagon: 'M8 5h8l4 7-4 7H8l-4-7z',
    star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z',
    heart: 'M12 20s-8-4.8-8-10.5A4.5 4.5 0 0112 7a4.5 4.5 0 018 2.5C20 15.2 12 20 12 20z',
    callout: 'M6 5h12a2 2 0 012 2v7a2 2 0 01-2 2h-7l-4 4v-4H6a2 2 0 01-2-2V7a2 2 0 012-2z',
    blockArrow: 'M4 9h9V5l7 7-7 7v-4H4z',
    line: 'M5 19L19 5',
    arrow: 'M5 19L19 5M10 5h9v9',
  };
  const KINDS = (Object.keys(SHAPE_LABELS) as ShapeKind[]).map((value) => ({
    value,
    label: SHAPE_LABELS[value],
    icon: ICONS[value],
  }));

  // Drawn pointing right, as each style looks.
  const HEADS: { value: ArrowHead; label: string; icon: string; filled: boolean }[] = [
    { value: 'open', label: 'Open tip', icon: 'M4 12h15M13 6l6 6-6 6', filled: false },
    { value: 'triangle', label: 'Filled tip', icon: 'M4 12h10M13 6l7 6-7 6z', filled: true },
    { value: 'notched', label: 'Notched tip', icon: 'M4 12h12M12 6l8 6-8 6 2.5-6z', filled: true },
  ];

  // Each drawn as a short line with its own pattern.
  const LINE_STYLES: { value: LineStyle; label: string; dashes?: string }[] = [
    { value: 'solid', label: 'Solid' },
    { value: 'dashed', label: 'Dashed', dashes: '3 4' },
    { value: 'dotted', label: 'Dotted', dashes: '0 4' },
    { value: 'dashdot', label: 'Dash-dot', dashes: '4 4 0 4' },
  ];

  const valueOf =(e: Event) => Number((e.target as HTMLInputElement).value);
</script>

<div>
  <PanelHeader title="Shapes" {onClose} />

  <p class="text-xs text-neutral-500 dark:text-neutral-400">
    {selected
      ? 'Changes apply to the selected shape, and to the next one you draw.'
      : 'Drag on the page to draw. Hold Ctrl for a square, a circle, or a straight line, and Shift to draw out from the centre.'}
  </p>

  <div class="mt-4 flex flex-col gap-4 text-xs text-neutral-600 dark:text-neutral-300">
    <div class="flex flex-col gap-2">
      <span>Shape</span>
      <div class="grid grid-cols-7 gap-1">
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

    {#if style.kind === 'arrow'}
      <div class="flex items-center justify-between gap-2">
        <span>Tip</span>
        <div class="flex gap-1">
          {#each HEADS as head (head.value)}
            <button
              type="button"
              aria-label={head.label}
              aria-pressed={style.arrowHead === head.value}
              use:tooltip={head.label}
              class="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors {style.arrowHead ===
              head.value
                ? 'border-fuchsia-600 bg-fuchsia-600 text-white'
                : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'}"
              onclick={() => set({ arrowHead: head.value })}
            >
              <svg
                viewBox="0 0 24 24"
                fill={head.filled ? 'currentColor' : 'none'}
                stroke="currentColor"
                stroke-width="2"
                class="h-4 w-4"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d={head.icon} />
              </svg>
            </button>
          {/each}
        </div>
      </div>
    {/if}

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

    {#if style.strokeWidth > 0}
      <div class="flex items-center justify-between gap-2">
        <span>Style</span>
        <div class="flex gap-1">
          {#each LINE_STYLES as lineStyle (lineStyle.value)}
            <button
              type="button"
              aria-label={lineStyle.label}
              aria-pressed={style.lineStyle === lineStyle.value}
              use:tooltip={lineStyle.label}
              class="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors {style.lineStyle ===
              lineStyle.value
                ? 'border-fuchsia-600 bg-fuchsia-600 text-white'
                : 'border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'}"
              onclick={() => set({ lineStyle: lineStyle.value })}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
                <path stroke-linecap="round" stroke-dasharray={lineStyle.dashes} d="M3 12h18" />
              </svg>
            </button>
          {/each}
        </div>
      </div>
    {/if}

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
