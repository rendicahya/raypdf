<script lang="ts">
  import { FONT_FAMILY_CSS } from '../../stores/textTool';
  import type { PageWatermarkSettings } from '../../lib/pdf/pageWatermark';
  import type { StoredImage } from '../../stores/images';

  // The page watermark as lib/pdf/pageWatermark.ts draws it on export, each
  // stamp turned around its centre. Never takes clicks.

  interface Props {
    watermark: PageWatermarkSettings;
    /** Stamp centres and sizes, in points on the page as shown. */
    stamps: { x: number; y: number; width: number; height: number }[];
    /** The picture, for a picture watermark. */
    image: StoredImage | undefined;
    /** Canvas pixels per point. */
    unit: number;
  }

  let { watermark, stamps, image, unit }: Props = $props();
</script>

<div class="pointer-events-none absolute inset-0 select-none overflow-hidden rounded-lg" aria-hidden="true">
  {#each stamps as stamp}
    {#if image}
      <img
        src={image.url}
        alt=""
        class="absolute max-w-none"
        style:left="{stamp.x * unit}px"
        style:top="{stamp.y * unit}px"
        style:width="{stamp.width * unit}px"
        style:height="{stamp.height * unit}px"
        style:opacity={watermark.opacity}
        style:transform="translate(-50%, -50%) rotate({-watermark.angle}deg)"
      />
    {:else}
      <div
        class="absolute whitespace-nowrap leading-none"
        style:left="{stamp.x * unit}px"
        style:top="{stamp.y * unit}px"
        style:font-family={FONT_FAMILY_CSS[watermark.font]}
        style:font-weight={watermark.bold ? 700 : 400}
        style:font-size="{watermark.fontSize * unit}px"
        style:color={watermark.color}
        style:opacity={watermark.opacity}
        style:transform="translate(-50%, -50%) rotate({-watermark.angle}deg)"
      >
        {watermark.text.trim()}
      </div>
    {/if}
  {/each}
</div>
