<script lang="ts">
  import { editorStore, type PlacedImage } from '../../stores/editor';
  import { imageFor } from '../../stores/images';
  import { imagePropertiesId, openImageProperties } from '../../stores/toolPanel';
  import { getPageContext } from './pageContext.svelte';
  import PlacedBox from '../PlacedBox.svelte';

  // The images placed on one page, moved, resized (keeping their shape),
  // and removed through PlacedBox. A double-click opens their Properties
  // (ImageOptions), which follows the selection to another image and closes
  // when a click deselects the image. Placing them is PDFViewer's.

  interface Props {
    images: PlacedImage[];
  }

  let { images }: Props = $props();

  const page = getPageContext();
  const selection = page.selection;
  const bounds = () => {
    const rect = page.canvasRect();
    return { width: rect.width, height: rect.height };
  };
</script>

{#each images as img (img.id)}
  {@const stored = imageFor(img.imageId)}
  {#if stored}
    <PlacedBox
      attr="placed-image"
      id={img.id}
      box={img}
      selected={selection.imageId === img.id}
      label="Image"
      keepAspect
      minSize={16}
      {bounds}
      onSelect={() => {
        selection.imageId = img.id;
        if ($imagePropertiesId) $imagePropertiesId = img.id;
      }}
      onDeselect={() => {
        if (selection.imageId === img.id) selection.imageId = null;
        // Closed when the click went anywhere but another image, which
        // takes the panel over in the same click.
        setTimeout(() => {
          if ($imagePropertiesId === img.id && selection.imageId !== img.id) $imagePropertiesId = null;
        });
      }}
      onChange={(geometry) => editorStore.updateImage(img.id, geometry)}
      onRemove={() => {
        editorStore.removeImage(img.id);
        selection.imageId = null;
      }}
      onDoubleClick={() => openImageProperties(img.id)}
    >
      <img src={stored.url} alt="" draggable="false" class="h-full w-full select-none" style:opacity={img.opacity} />
    </PlacedBox>
  {/if}
{/each}
