<script lang="ts">
  import { editorStore, type PlacedShape } from '../../stores/editor';
  import { selectedShapeId, isLineKind, SHAPE_LABELS } from '../../stores/shapeTool';
  import { openShapeTool } from '../../stores/toolPanel';
  import { getPageContext } from './pageContext.svelte';
  import PlacedBox from '../PlacedBox.svelte';
  import ShapeGraphic from '../ShapeGraphic.svelte';

  // The shapes drawn on one page, moved, resized, turned (lines and arrows
  // are reshaped by their ends instead), and removed through PlacedBox. A
  // double-click opens their style in the Shapes panel. Drawing new ones is
  // PDFViewer's (a drag on the canvas while Shapes is on).

  interface Props {
    shapes: PlacedShape[];
  }

  let { shapes }: Props = $props();

  const page = getPageContext();
  const bounds = () => {
    const rect = page.canvasRect();
    return { width: rect.width, height: rect.height };
  };
</script>

{#each shapes as s (s.id)}
  <PlacedBox
    attr="placed-shape"
    id={s.id}
    box={s}
    selected={$selectedShapeId === s.id}
    label={SHAPE_LABELS[s.kind]}
    minSize={8}
    pad={isLineKind(s.kind) ? 6 : 0}
    {bounds}
    onSelect={() => ($selectedShapeId = s.id)}
    onDeselect={() => {
      if ($selectedShapeId === s.id) $selectedShapeId = null;
    }}
    onChange={(geometry) => editorStore.updateShape(s.id, geometry)}
    onRemove={() => {
      editorStore.removeShape(s.id);
      $selectedShapeId = null;
    }}
    onDoubleClick={() => {
      $selectedShapeId = s.id;
      openShapeTool();
    }}
    angle={s.angle}
    onRotate={isLineKind(s.kind) ? undefined : (angle) => editorStore.updateShape(s.id, { angle })}
    line={isLineKind(s.kind) ? { flipX: s.flipX, flipY: s.flipY } : undefined}
    onLineChange={(geometry) => editorStore.updateShape(s.id, geometry)}
  >
    <ShapeGraphic shape={s} />
  </PlacedBox>
{/each}
