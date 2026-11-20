<script module lang="ts">
  import type { FormWidget } from '../../lib/pdf/forms';

  /** A form widget placed in canvas pixels, with its font size in pixels. */
  export type FormBox = FormWidget & { left: number; top: number; boxWidth: number; boxHeight: number; fontPx: number };
</script>

<script lang="ts">
  import { editorStore } from '../../stores/editor';
  import { widgetValue, type FormValues } from '../../lib/pdf/forms';

  // The PDF's own form fields on one page (lib/pdf/forms.ts), as HTML inputs:
  // pdf.js leaves form widgets out of the canvas render, so these are what
  // the user sees and types into. The layer itself never takes clicks, only
  // the inputs do, and only in Move mode, so they never swallow a click meant
  // for a tool.

  interface Props {
    boxes: FormBox[];
    values: FormValues;
    interactive: boolean;
    /** Keeps radio groups of different documents apart. */
    docId: string | null;
  }

  let { boxes, values, interactive, docId }: Props = $props();
</script>

{#if boxes.length > 0}
  <div class="pointer-events-none absolute inset-0">
    {#each boxes as f (f.id)}
      {@const value = widgetValue(f, values)}
      {@const fieldClass = `absolute m-0 rounded-sm border border-blue-400/50 bg-blue-100/40 text-black outline-none
        focus:border-blue-500 focus:bg-white/90 disabled:cursor-not-allowed disabled:bg-transparent
        ${interactive ? 'pointer-events-auto' : ''}`}
      {@const position = `left:${f.left}px;top:${f.top}px;width:${f.boxWidth}px;height:${f.boxHeight}px;`}
      {#if f.kind === 'text' && f.multiLine}
        <textarea
          aria-label={f.fieldName}
          class="{fieldClass} resize-none p-0.5 leading-tight"
          style="{position}font-size:{f.fontPx}px;text-align:{f.align};"
          value={typeof value === 'string' ? value : ''}
          maxlength={f.maxLen ?? undefined}
          disabled={f.readOnly}
          oninput={(e) => editorStore.setFormValue(f.fieldName, e.currentTarget.value)}
        ></textarea>
      {:else if f.kind === 'text'}
        <input
          type="text"
          aria-label={f.fieldName}
          class="{fieldClass} px-0.5"
          style="{position}font-size:{f.fontPx}px;text-align:{f.align};"
          value={typeof value === 'string' ? value : ''}
          maxlength={f.maxLen ?? undefined}
          disabled={f.readOnly}
          oninput={(e) => editorStore.setFormValue(f.fieldName, e.currentTarget.value)}
        />
      {:else if f.kind === 'checkbox'}
        <input
          type="checkbox"
          aria-label={f.fieldName}
          class="{fieldClass} cursor-pointer accent-blue-600"
          style={position}
          checked={value === true}
          disabled={f.readOnly}
          onchange={(e) => editorStore.setFormValue(f.fieldName, e.currentTarget.checked)}
        />
      {:else if f.kind === 'radio'}
        <input
          type="radio"
          aria-label="{f.fieldName}: {f.onValue}"
          name="{docId}:{f.fieldName}"
          class="{fieldClass} cursor-pointer accent-blue-600"
          style={position}
          checked={value === f.onValue}
          disabled={f.readOnly}
          onchange={() => editorStore.setFormValue(f.fieldName, f.onValue)}
        />
      {:else}
        <select
          aria-label={f.fieldName}
          class="{fieldClass} cursor-pointer p-0"
          style="{position}font-size:{f.fontPx}px;"
          value={typeof value === 'string' ? value : ''}
          disabled={f.readOnly}
          onchange={(e) => editorStore.setFormValue(f.fieldName, e.currentTarget.value)}
        >
          <option value=""></option>
          {#each f.options as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      {/if}
    {/each}
  </div>
{/if}
