<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { portal } from '../lib/utils/portal';
  import { signatureStore } from '../stores/signature';
  import { labelFromFileName } from '../lib/signature/db';
  import {
    SIGNATURE_FONTS,
    INK_COLORS,
    trimToPng,
    renderTypedSignature,
    type SignatureFont,
  } from '../lib/signature/create';
  import { isFileAccepted, formatFileSize, MAX_SIGNATURE_SIZE_BYTES } from '../lib/utils/fileValidation';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  type Mode = 'draw' | 'type' | 'upload';
  let mode: Mode = $state('draw');
  let color: string = $state(INK_COLORS[0].value);
  let saving = $state(false);
  let error: string | null = $state(null);

  // ── Draw ────────────────────────────────────────────────────────────────
  // Drawn at 3× the on-screen size so the saved image prints sharply.
  const DRAW_SCALE = 3;
  const PEN_WIDTH = 2.5;
  type Point = { x: number; y: number; w: number };
  type Stroke = { color: string; points: Point[] };
  let canvasEl: HTMLCanvasElement | undefined = $state();
  let strokes: Stroke[] = $state.raw([]);
  let current: Stroke | null = null;

  function sizeCanvas() {
    if (!canvasEl) return;
    canvasEl.width = canvasEl.clientWidth * DRAW_SCALE;
    canvasEl.height = canvasEl.clientHeight * DRAW_SCALE;
    redraw();
  }

  // Sized whenever the Draw tab's canvas appears — not on every stroke.
  $effect(() => {
    if (mode === 'draw' && canvasEl) untrack(sizeCanvas);
  });

  function pointFrom(e: PointerEvent): Point {
    const rect = canvasEl!.getBoundingClientRect();
    // A pen's pressure varies the line; mouse and touch report a flat 0.5.
    const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    return {
      x: (e.clientX - rect.left) * DRAW_SCALE,
      y: (e.clientY - rect.top) * DRAW_SCALE,
      w: PEN_WIDTH * DRAW_SCALE * (0.6 + pressure * 0.8),
    };
  }

  // Smooths each stroke with quadratic curves through the midpoints between samples.
  function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
    const pts = stroke.points;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, pts[0].w / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const p = pts[i];
      const startX = i === 1 ? prev.x : (pts[i - 2].x + prev.x) / 2;
      const startY = i === 1 ? prev.y : (pts[i - 2].y + prev.y) / 2;
      ctx.beginPath();
      ctx.lineWidth = (prev.w + p.w) / 2;
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + p.x) / 2, (prev.y + p.y) / 2);
      ctx.stroke();
    }
  }

  function redraw() {
    const ctx = canvasEl?.getContext('2d');
    if (!ctx || !canvasEl) return;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    for (const stroke of strokes) drawStroke(ctx, stroke);
    if (current) drawStroke(ctx, current);
  }

  function onPadPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    canvasEl!.setPointerCapture(e.pointerId);
    current = { color, points: [pointFrom(e)] };
    redraw();
  }

  function onPadPointerMove(e: PointerEvent) {
    if (!current) return;
    // Coalesced events keep fast strokes smooth instead of turning them into polygons.
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ev of events.length > 0 ? events : [e]) current.points.push(pointFrom(ev));
    redraw();
  }

  function onPadPointerUp() {
    if (!current) return;
    strokes = [...strokes, current];
    current = null;
    redraw();
  }

  function undoStroke() {
    strokes = strokes.slice(0, -1);
    redraw();
  }

  function clearPad() {
    strokes = [];
    redraw();
  }

  // Recolors what's already drawn, so picking blue after drawing still works.
  function setColor(value: string) {
    color = value;
    strokes = strokes.map((s) => ({ ...s, color: value }));
    redraw();
  }

  // ── Type ────────────────────────────────────────────────────────────────
  let typedName = $state('');
  let font: SignatureFont = $state(SIGNATURE_FONTS[0]);

  // ── Save ────────────────────────────────────────────────────────────────
  const canSave = $derived(mode === 'draw' ? strokes.length > 0 : mode === 'type' ? typedName.trim() !== '' : false);

  async function save() {
    if (!canSave || saving) return;
    saving = true;
    error = null;
    try {
      if (mode === 'draw') {
        const blob = canvasEl ? await trimToPng(canvasEl) : null;
        if (!blob) throw new Error('Draw your signature first.');
        await signatureStore.add(blob, { fileName: 'drawn-signature.png', kind: 'drawn', label: 'Drawn signature' });
      } else {
        const text = typedName.trim();
        const blob = await renderTypedSignature(text, font, color);
        if (!blob) throw new Error("Couldn't render that text.");
        await signatureStore.add(blob, { fileName: 'typed-signature.png', kind: 'typed', label: text });
      }
      onClose();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to save the signature';
    } finally {
      saving = false;
    }
  }

  // ── Upload ──────────────────────────────────────────────────────────────
  let isDragOver = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();

  async function uploadFile(file: File | undefined) {
    if (!file) return;
    if (!isFileAccepted(file, 'image/*')) {
      error = 'Please choose an image file.';
      return;
    }
    if (file.size > MAX_SIGNATURE_SIZE_BYTES) {
      error = `"${file.name}" is ${formatFileSize(file.size)} — the limit is ${formatFileSize(MAX_SIGNATURE_SIZE_BYTES)}.`;
      return;
    }
    saving = true;
    error = null;
    try {
      await signatureStore.add(file, { fileName: file.name, kind: 'upload', label: labelFromFileName(file.name) });
      onClose();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to save the signature';
    } finally {
      saving = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  let dialogEl: HTMLDivElement;
  onMount(() => dialogEl.focus());

  const TABS: { value: Mode; label: string }[] = [
    { value: 'draw', label: 'Draw' },
    { value: 'type', label: 'Type' },
    { value: 'upload', label: 'Upload' },
  ];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:portal
  class="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
  onpointerdown={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
>
  <div
    bind:this={dialogEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby="signature-creator-title"
    tabindex="-1"
    class="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-5 shadow-xl outline-none
      dark:border-neutral-800 dark:bg-neutral-900"
    onkeydown={onKeydown}
  >
    <div class="mb-4 flex items-center justify-between">
      <h2 id="signature-creator-title" class="text-base font-semibold text-neutral-800 dark:text-neutral-100">
        New signature
      </h2>
      <div role="tablist" class="flex rounded-lg bg-neutral-100 p-0.5 text-xs font-medium dark:bg-neutral-800">
        {#each TABS as tab}
          <button
            type="button"
            role="tab"
            aria-selected={mode === tab.value}
            class="rounded-md px-3 py-1 transition-colors {mode === tab.value
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white'
              : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'}"
            onclick={() => {
              mode = tab.value;
              error = null;
            }}
          >
            {tab.label}
          </button>
        {/each}
      </div>
    </div>

    {#if mode !== 'upload'}
      <div class="mb-2 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        Ink
        {#each INK_COLORS as ink}
          <button
            type="button"
            aria-label={ink.label}
            aria-pressed={color === ink.value}
            class="h-5 w-5 rounded-full border-2 transition-transform {color === ink.value
              ? 'scale-110 border-blue-400'
              : 'border-white dark:border-neutral-900'}"
            style:background-color={ink.value}
            onclick={() => setColor(ink.value)}
          ></button>
        {/each}
      </div>
    {/if}

    {#if mode === 'draw'}
      <div class="relative">
        <canvas
          bind:this={canvasEl}
          class="h-44 w-full touch-none rounded-xl border border-dashed border-neutral-300 bg-white
            dark:border-neutral-600"
          style:cursor="crosshair"
          onpointerdown={onPadPointerDown}
          onpointermove={onPadPointerMove}
          onpointerup={onPadPointerUp}
          onpointercancel={onPadPointerUp}
        ></canvas>
        {#if strokes.length === 0}
          <span
            class="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-neutral-400"
          >
            Sign here with your mouse, finger, or pen
          </span>
        {/if}
        <div class="pointer-events-none absolute bottom-8 left-6 right-6 border-b border-neutral-200"></div>
      </div>
      <div class="mt-2 flex justify-end gap-3 text-xs font-medium">
        <button
          type="button"
          class="text-neutral-500 hover:text-neutral-800 disabled:opacity-40 dark:text-neutral-400 dark:hover:text-neutral-200"
          disabled={strokes.length === 0}
          onclick={undoStroke}
        >
          Undo stroke
        </button>
        <button
          type="button"
          class="text-neutral-500 hover:text-red-600 disabled:opacity-40 dark:text-neutral-400"
          disabled={strokes.length === 0}
          onclick={clearPad}
        >
          Clear
        </button>
      </div>
    {:else if mode === 'type'}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        autofocus
        maxlength="60"
        placeholder="Type your name"
        bind:value={typedName}
        onkeydown={(e) => {
          if (e.key === 'Enter') save();
        }}
        class="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-400
          focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-neutral-700 dark:bg-neutral-800
          dark:text-neutral-100"
      />
      <div class="mt-3 grid grid-cols-2 gap-2">
        {#each SIGNATURE_FONTS as option}
          <button
            type="button"
            aria-pressed={font === option}
            aria-label="{option} style"
            class="flex h-16 items-center justify-center overflow-hidden rounded-lg border bg-white px-2
              text-3xl transition-colors {font === option
              ? 'border-blue-500 ring-2 ring-blue-400/40'
              : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-700'}"
            style:font-family={`"${option}", cursive`}
            style:color={color}
            onclick={() => (font = option)}
          >
            <span class="truncate">{typedName.trim() || 'Your Name'}</span>
          </button>
        {/each}
      </div>
    {:else}
      <button
        type="button"
        class="flex h-44 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed
          text-center transition-colors {isDragOver
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
          : 'border-neutral-300 bg-neutral-50 hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800'}"
        disabled={saving}
        ondragover={(e) => {
          e.preventDefault();
          isDragOver = true;
        }}
        ondragleave={() => (isDragOver = false)}
        ondrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          isDragOver = false;
          uploadFile(e.dataTransfer?.files[0]);
        }}
        onclick={() => fileInput?.click()}
      >
        <span class="text-sm font-medium text-neutral-700 dark:text-neutral-200">Upload a scan or photo</span>
        <span class="text-xs text-neutral-500 dark:text-neutral-400">
          Drag & drop or click to browse — PNG or JPEG, up to {formatFileSize(MAX_SIGNATURE_SIZE_BYTES)}
        </span>
      </button>
      <input
        bind:this={fileInput}
        type="file"
        accept="image/*"
        class="hidden"
        onchange={(e) => {
          const input = e.currentTarget;
          uploadFile(input.files?.[0]);
          input.value = '';
        }}
      />
    {/if}

    {#if error}
      <p class="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
    {/if}

    <div class="mt-5 flex justify-end gap-2">
      <button
        type="button"
        class="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100
          dark:text-neutral-300 dark:hover:bg-neutral-800"
        onclick={onClose}
      >
        Cancel
      </button>
      {#if mode !== 'upload'}
        <button
          type="button"
          class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700
            disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canSave || saving}
          onclick={save}
        >
          {saving ? 'Saving…' : 'Save signature'}
        </button>
      {/if}
    </div>
  </div>
</div>
