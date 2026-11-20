<script lang="ts">
  import { FONT_FAMILY_CSS } from '../../stores/textTool';
  import type { PageLabel } from '../../lib/pdf/pageNumbers';

  // Page number, header, and footer, as lib/pdf/pageNumbers.ts draws them on
  // export. With line-height 1 the baseline sits about 0.85em below the box top.

  interface Props {
    labels: PageLabel[];
    /** Canvas pixels per point. */
    unit: number;
  }

  let { labels, unit }: Props = $props();
</script>

{#each labels as s}
  {@const [vertical, horizontal] = s.position.split('-')}
  <div
    class="pointer-events-none absolute select-none whitespace-nowrap leading-none"
    style:font-family={FONT_FAMILY_CSS[s.font]}
    style:font-size="{s.fontSize * unit}px"
    style:color={s.color}
    style:left={horizontal === 'left' ? `${s.margin * unit}px` : horizontal === 'center' ? '50%' : null}
    style:right={horizontal === 'right' ? `${s.margin * unit}px` : null}
    style:transform={horizontal === 'center' ? 'translateX(-50%)' : null}
    style:top={vertical === 'top' ? `${(s.margin - 0.13 * s.fontSize) * unit}px` : null}
    style:bottom={vertical === 'bottom' ? `${(s.margin - 0.15 * s.fontSize) * unit}px` : null}
  >
    {s.text}
  </div>
{/each}
