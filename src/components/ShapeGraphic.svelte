<script lang="ts">
  import type { PlacedShape } from '../stores/editor';
  import { insetBox, lineGeometry } from '../lib/pdf/shapes';

  // A shape drawn with SVG, filling its box: the same geometry that
  // screenshots and export use (lib/pdf/shapes.ts).

  type ShapeStyle = Pick<
    PlacedShape,
    'kind' | 'width' | 'height' | 'stroke' | 'strokeWidth' | 'fill' | 'opacity' | 'flipX' | 'flipY'
  >;

  let { shape }: { shape: ShapeStyle } = $props();

  // Drawn relative to the box's own top-left corner.
  const local = $derived({ ...shape, x: 0, y: 0 });
  const line = $derived(shape.kind === 'line' || shape.kind === 'arrow' ? lineGeometry(local) : null);
  const inset = $derived(insetBox(local));
  // Room around the box for line caps and arrowheads, and so a perfectly
  // flat line (no height) still has an SVG to be drawn in.
  const margin = $derived(20 + shape.strokeWidth * 4);
</script>

<svg
  class="absolute"
  style:left="{-margin}px"
  style:top="{-margin}px"
  width={shape.width + margin * 2}
  height={shape.height + margin * 2}
  opacity={shape.opacity}
  aria-hidden="true"
>
  <g transform="translate({margin} {margin})">
  {#if line}
    <g fill="none" stroke={shape.stroke} stroke-width={shape.strokeWidth} stroke-linecap="round">
      {#each [[line.start, line.end], ...line.head] as [a, b]}
        <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
      {/each}
    </g>
  {:else if shape.kind === 'rectangle'}
    <rect
      x={inset.x}
      y={inset.y}
      width={inset.width}
      height={inset.height}
      fill={shape.fill ?? 'none'}
      stroke={shape.strokeWidth > 0 ? shape.stroke : 'none'}
      stroke-width={shape.strokeWidth}
    />
  {:else}
    <ellipse
      cx={inset.x + inset.width / 2}
      cy={inset.y + inset.height / 2}
      rx={inset.width / 2}
      ry={inset.height / 2}
      fill={shape.fill ?? 'none'}
      stroke={shape.strokeWidth > 0 ? shape.stroke : 'none'}
      stroke-width={shape.strokeWidth}
    />
  {/if}
  </g>
</svg>
