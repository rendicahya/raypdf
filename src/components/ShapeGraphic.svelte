<script lang="ts">
  import type { PlacedShape } from '../stores/editor';
  import { dashPattern, lineGeometry, outlinePath, pathData, shapeOutline } from '../lib/pdf/shapes';

  // A shape drawn with SVG, filling its box: the same geometry that
  // screenshots and export use (lib/pdf/shapes.ts).

  type ShapeStyle = Pick<
    PlacedShape,
    | 'kind'
    | 'width'
    | 'height'
    | 'stroke'
    | 'strokeWidth'
    | 'fill'
    | 'opacity'
    | 'flipX'
    | 'flipY'
    | 'arrowHead'
    | 'lineStyle'
  >;

  let { shape }: { shape: ShapeStyle } = $props();

  // Drawn relative to the box's own top-left corner.
  const local = $derived({ ...shape, x: 0, y: 0 });
  const line = $derived(shape.kind === 'line' || shape.kind === 'arrow' ? lineGeometry(local) : null);
  const dashes = $derived(dashPattern(shape.lineStyle, shape.strokeWidth)?.join(' '));
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
      {#each line.strokes as [a, b], i}
        <!-- Only the line itself is patterned, not an open head's wings. -->
        <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke-dasharray={i === 0 ? dashes : undefined} />
      {/each}
    </g>
    {#if line.fills.length}
      <path d={outlinePath(line.fills)} fill={shape.stroke} />
    {/if}
  {:else}
    <!-- Miter limit 10, as in canvas and PDF, so pointed corners match. -->
    <path
      d={pathData(shapeOutline(local))}
      fill={shape.fill ?? 'none'}
      stroke={shape.strokeWidth > 0 ? shape.stroke : 'none'}
      stroke-width={shape.strokeWidth}
      stroke-miterlimit="10"
      stroke-dasharray={dashes}
      stroke-linecap={dashes ? 'round' : undefined}
    />
  {/if}
  </g>
</svg>
