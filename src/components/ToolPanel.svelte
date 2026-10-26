<script lang="ts">
  import SignaturePanel from './SignaturePanel.svelte';
  import RedactOptions from './toolOptions/RedactOptions.svelte';
  import TextOptions from './toolOptions/TextOptions.svelte';
  import CommentOptions from './toolOptions/CommentOptions.svelte';
  import SelectOptions from './toolOptions/SelectOptions.svelte';
  import ScreenshotOptions from './toolOptions/ScreenshotOptions.svelte';
  import PageTextOptions from './toolOptions/PageTextOptions.svelte';
  import PageWatermarkOptions from './toolOptions/PageWatermarkOptions.svelte';
  import ShapeOptions from './toolOptions/ShapeOptions.svelte';
  import CropOptions from './toolOptions/CropOptions.svelte';
  import { signatureToolMode } from '../stores/signatureTool';
  import { pageNumbersToolMode } from '../stores/pageNumbersTool';
  import { pageWatermarkToolMode } from '../stores/pageWatermarkTool';
  import { cropToolMode } from '../stores/cropTool';
  import { toolPanelOpen, type PanelTool } from '../stores/toolPanel';

  interface Props {
    tool: PanelTool;
  }

  let { tool }: Props = $props();

  // The Signature, Page numbers, Watermark, and Crop tools can't do without their panel, so
  // closing it turns the tool off; for the others the × only hides the options.
  const hide = () => toolPanelOpen.set(false);
</script>

{#if tool === 'signature'}
  <SignaturePanel onClose={() => signatureToolMode.set(false)} />
{:else if tool === 'redact'}
  <RedactOptions onClose={hide} />
{:else if tool === 'text'}
  <TextOptions onClose={hide} />
{:else if tool === 'comment'}
  <CommentOptions onClose={hide} />
{:else if tool === 'select'}
  <SelectOptions onClose={hide} />
{:else if tool === 'screenshot'}
  <ScreenshotOptions onClose={hide} />
{:else if tool === 'pageNumbers'}
  <PageTextOptions onClose={() => pageNumbersToolMode.set(false)} />
{:else if tool === 'watermark'}
  <PageWatermarkOptions onClose={() => pageWatermarkToolMode.set(false)} />
{:else if tool === 'shapes'}
  <ShapeOptions onClose={hide} />
{:else if tool === 'crop'}
  <CropOptions onClose={() => cropToolMode.set(false)} />
{/if}
