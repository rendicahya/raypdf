<script lang="ts" module>
  export type FeatureKind =
    | 'onePass'
    | 'sign'
    | 'forms'
    | 'markup'
    | 'redact'
    | 'pages'
    | 'find'
    | 'save'
    | 'verify'
    | 'offline';
</script>

<script lang="ts">
  // Small decorative drawings for the front page's feature rows. Each one
  // shows the feature at a glance; the row's text says the same thing.

  interface Props {
    kind: FeatureKind;
    label: string;
  }

  let { kind, label }: Props = $props();

  const SIGNATURE = 'M2 22c6-14 10-20 13-14s-6 18-2 16 8-16 12-14-2 12 2 12 6-10 9-9 0 8 4 8 9-6 14-8 10-2 14-3';

  const PAGE = 'fill-white stroke-neutral-200 dark:fill-neutral-800 dark:stroke-neutral-700';
  const LINE = 'fill-neutral-200 dark:fill-neutral-700';
  const INK = 'stroke-neutral-900 dark:stroke-neutral-100';
  const STRONG = 'fill-neutral-700 dark:fill-neutral-200';
  const MUTED = 'fill-neutral-500 dark:fill-neutral-400';
  const FIELD = 'fill-white stroke-neutral-300 dark:fill-neutral-900 dark:stroke-neutral-600';
  const ARROW = 'stroke-blue-400 dark:stroke-blue-500';

  const arrowId = $derived(`fi-arrow-${kind}`);

  const SAVE_OPTIONS = ['Compressed', 'One file per page', 'Merged', 'Printed'];
  const ONE_PASS_STEPS = [
    { label: 'Sign', dot: 'fill-blue-500' },
    { label: 'Redact', dot: 'fill-neutral-900 dark:fill-neutral-100' },
    { label: 'Page numbers', dot: 'fill-teal-500' },
    { label: 'Compress', dot: 'fill-emerald-500' },
  ];
</script>

<svg viewBox="0 0 240 150" class="mx-auto h-auto w-full max-w-sm" role="img" aria-label={label}>
  {#snippet page(x: number, y: number, w: number, h: number)}
    <rect {x} {y} width={w} height={h} rx="6" class={PAGE} stroke-width="1.5" />
  {/snippet}

  {#snippet lines(x: number, y: number, w: number, count: number, gap: number)}
    {#each { length: count } as _, i}
      <rect {x} y={y + i * gap} width={i === count - 1 ? w * 0.6 : w} height="4" rx="2" class={LINE} />
    {/each}
  {/snippet}

  {#snippet arrow(d: string)}
    <path {d} fill="none" stroke-width="1.5" marker-end="url(#{arrowId})" class={ARROW} />
  {/snippet}

  <defs>
    <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0 0l10 5-10 5z" class="fill-blue-500" />
    </marker>
  </defs>

  {#if kind === 'onePass'}
    {#each ONE_PASS_STEPS as step, i (step.label)}
      {@const y = 16 + i * 30}
      <rect x="8" {y} width="82" height="20" rx="10" class={PAGE} stroke-width="1.5" />
      <circle cx="19" cy={y + 10} r="3" class={step.dot} />
      <text x="27" y={y + 13.5} font-size="9" class={STRONG}>{step.label}</text>
      {@render arrow(`M92 ${y + 10}C108 ${y + 10} 106 73 120 73`)}
    {/each}
    {@render page(124, 38, 52, 70)}
    {@render lines(132, 50, 36, 4, 9)}
    <rect x="132" y="84" width="26" height="5" rx="1" class="fill-neutral-900 dark:fill-black" />
    <path d={SIGNATURE} transform="translate(134 86) scale(0.4)" fill="none" stroke-width="3" class={INK} />
    <text x="150" y="103" text-anchor="middle" font-size="6" class="fill-teal-600 dark:fill-teal-400">1</text>
    {@render arrow('M178 73h10')}
    <rect x="192" y="62" width="42" height="22" rx="11" class="fill-blue-600" />
    <text x="213" y="76.5" text-anchor="middle" font-size="9" font-weight="600" class="fill-white">Save</text>
    <text x="213" y="98" text-anchor="middle" font-size="7" class={MUTED}>once</text>
  {:else if kind === 'sign'}
    {@render page(20, 10, 120, 130)}
    {@render lines(32, 24, 96, 5, 10)}
    <rect
      x="32"
      y="84"
      width="96"
      height="36"
      rx="4"
      stroke-dasharray="4 3"
      class="fill-blue-50/60 stroke-blue-400 dark:fill-blue-950/40"
    />
    <text x="80" y="105" text-anchor="middle" font-size="8" class="fill-blue-400">Sign here</text>
    <line x1="40" y1="128" x2="120" y2="128" class="stroke-neutral-300 dark:stroke-neutral-600" />
    {@render arrow('M152 60C142 78 130 86 118 90')}
    <g transform="translate(150 18) rotate(4)">
      <rect x="2" y="3" width="76" height="34" rx="6" class="fill-neutral-900/10" />
      <rect width="76" height="34" rx="6" stroke-width="1.5" class="fill-white stroke-blue-500 dark:fill-neutral-800" />
      <path
        d={SIGNATURE}
        transform="translate(10 5) scale(0.8)"
        fill="none"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class={INK}
      />
    </g>
    <path
      d="M0 0v14l4-4 3 7 3-1-3-7h5z"
      transform="translate(214 44)"
      stroke-width="1"
      class="fill-neutral-900 stroke-white dark:fill-white dark:stroke-neutral-900"
    />
    {#each ['Draw', 'Type', 'Upload'] as chip, i (chip)}
      <rect
        x="160"
        y={80 + i * 20}
        width="64"
        height="15"
        rx="7.5"
        class="fill-blue-50 stroke-blue-200 dark:fill-blue-950 dark:stroke-blue-900"
      />
      <text x="192" y={90.5 + i * 20} text-anchor="middle" font-size="8" class="fill-blue-700 dark:fill-blue-300">
        {chip}
      </text>
    {/each}
  {:else if kind === 'forms'}
    {@render page(60, 8, 120, 134)}
    <rect x="72" y="20" width="40" height="4" rx="2" class={LINE} />
    <rect x="72" y="28" width="96" height="18" rx="3" stroke-width="1.5" class="fill-white stroke-blue-400 dark:fill-neutral-900" />
    <text x="77" y="40.5" font-size="9" class={STRONG}>Jane Doe</text>
    <line x1="119" y1="32" x2="119" y2="42" stroke-width="1" class="stroke-blue-500" />
    <rect x="72" y="56" width="10" height="10" rx="2" class="fill-blue-600 stroke-blue-600" />
    <path d="M74.5 61l2 2 3.5-4" fill="none" stroke-width="1.5" stroke-linecap="round" class="stroke-white" />
    <rect x="88" y="59" width="60" height="4" rx="2" class={LINE} />
    <rect x="72" y="72" width="10" height="10" rx="2" class={FIELD} />
    <rect x="88" y="75" width="48" height="4" rx="2" class={LINE} />
    <rect x="72" y="90" width="36" height="4" rx="2" class={LINE} />
    <rect x="72" y="98" width="96" height="18" rx="3" class={FIELD} />
    <text x="77" y="110.5" font-size="9" class={STRONG}>Approved</text>
    <path d="M155 105l3 3 3-3" fill="none" stroke-width="1.5" stroke-linecap="round" class="stroke-neutral-400" />
    <line x1="72" y1="132" x2="140" y2="132" class="stroke-neutral-300 dark:stroke-neutral-600" />
  {:else if kind === 'markup'}
    {@render page(20, 8, 150, 134)}
    <rect x="28" y="33" width="96" height="10" rx="2" class="fill-yellow-300/80 dark:fill-yellow-400/50" />
    {@render lines(30, 24, 130, 5, 12)}
    <line x1="30" y1="55" x2="110" y2="55" stroke-width="1.2" class={INK} />
    <line x1="60" y1="62" x2="140" y2="62" stroke-width="1.2" class={INK} />
    <rect x="30" y="92" width="100" height="24" rx="3" fill="none" stroke-dasharray="4 3" class="stroke-blue-500" />
    <text x="36" y="108" font-size="10" class="fill-blue-700 dark:fill-blue-300">Approved, 25 Oct</text>
    <g transform="translate(176 26)">
      <rect width="50" height="50" rx="3" class="fill-amber-200 stroke-amber-300 dark:fill-amber-500/70 dark:stroke-amber-600" />
      <path d="M38 50l12-12H38z" class="fill-amber-300 dark:fill-amber-600" />
      {#each [10, 18, 26] as y (y)}
        <rect x="7" {y} width={y === 26 ? 22 : 36} height="3" rx="1.5" class="fill-amber-500/60" />
      {/each}
    </g>
  {:else if kind === 'redact'}
    {#each [12, 132] as x, i (x)}
      {@render page(x, 14, 96, 122)}
      {@render lines(x + 10, 28, 76, 3, 10)}
      {@render lines(x + 10, 80, 76, 4, 10)}
      {#if i === 0}
        <text x={x + 10} y="68" font-size="7.5" class={STRONG}>ID 3271 0402 88</text>
      {:else}
        <rect x={x + 8} y="60" width="80" height="12" rx="1" class="fill-neutral-900 dark:fill-black" />
      {/if}
    {/each}
    {@render arrow('M112 75h14')}
    <text x="60" y="147" text-anchor="middle" font-size="8" class={MUTED}>before</text>
    <text x="180" y="147" text-anchor="middle" font-size="8" class="fill-emerald-600 dark:fill-emerald-400">
      saved: text removed
    </text>
  {:else if kind === 'pages'}
    {#each [{ x: 14, n: 1 }, { x: 72, n: 2 }, { x: 188, n: 4 }] as thumb (thumb.n)}
      {@render page(thumb.x, 50, 44, 58)}
      {@render lines(thumb.x + 7, 59, 30, 3, 7)}
      <text x={thumb.x + 22} y="102" text-anchor="middle" font-size="7" class="fill-teal-600 dark:fill-teal-400">
        {thumb.n}
      </text>
    {/each}
    <rect x="130" y="50" width="44" height="58" rx="6" fill="none" stroke-dasharray="4 3" class="stroke-neutral-300 dark:stroke-neutral-600" />
    <g transform="translate(118 14) rotate(-8 22 29)">
      <rect x="3" y="4" width="44" height="58" rx="6" class="fill-neutral-900/10" />
      <rect width="44" height="58" rx="6" stroke-width="1.5" class="fill-white stroke-blue-500 dark:fill-neutral-800" />
      {@render lines(7, 9, 30, 3, 7)}
      <text x="22" y="52" text-anchor="middle" font-size="7" class="fill-teal-600 dark:fill-teal-400">3</text>
    </g>
    {@render arrow('M168 44c8 4 6 10 0 14')}
    <text x="120" y="130" text-anchor="middle" font-size="8" class={MUTED}>drag to reorder</text>
  {:else if kind === 'find'}
    <rect x="50" y="8" width="140" height="20" rx="10" class={FIELD} />
    <circle cx="62" cy="18" r="4" fill="none" stroke-width="1.5" class="stroke-neutral-400" />
    <path d="M65 21l3 3" stroke-width="1.5" stroke-linecap="round" class="stroke-neutral-400" />
    <text x="72" y="21.5" font-size="9" class={STRONG}>invoice</text>
    <text x="182" y="21.5" text-anchor="end" font-size="8" class={MUTED}>2 / 5</text>
    {@render page(30, 36, 180, 108)}
    {@render lines(42, 50, 156, 7, 12)}
    {#each [{ x: 60, y: 47 }, { x: 150, y: 59 }, { x: 80, y: 95 }, { x: 130, y: 119 }] as match (match.x)}
      <rect x={match.x} y={match.y} width="30" height="10" rx="2" class="fill-amber-300/70 dark:fill-amber-400/50" />
    {/each}
    <rect x="120" y="71" width="30" height="10" rx="2" stroke-width="1.2" class="fill-orange-400/60 stroke-orange-500" />
  {:else if kind === 'save'}
    {@render page(14, 38, 60, 76)}
    {@render lines(24, 50, 40, 3, 8)}
    <text x="44" y="98" text-anchor="middle" font-size="11" font-weight="700" class="fill-blue-600 dark:fill-blue-400">
      PDF
    </text>
    {#each SAVE_OPTIONS as option, i (option)}
      {@const y = 10 + i * 34}
      {@render arrow(`M76 76C98 76 98 ${y + 11} 118 ${y + 11}`)}
      <rect x="122" {y} width="106" height="22" rx="6" class={PAGE} stroke-width="1.5" />
      <circle cx="134" cy={y + 11} r="3" class="fill-blue-500" />
      <text x="143" y={y + 14.5} font-size="9" class={STRONG}>{option}</text>
    {/each}
  {:else if kind === 'verify'}
    {@render page(24, 12, 104, 128)}
    {@render lines(36, 28, 80, 6, 10)}
    <path
      d={SIGNATURE}
      transform="translate(40 96) scale(0.9)"
      fill="none"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={INK}
    />
    <g transform="translate(124 118)">
      <circle r="14" class="fill-emerald-500" />
      <path d="M-6 0l4 4 8-8" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="stroke-white" />
    </g>
    <rect x="146" y="34" width="86" height="72" rx="6" class="fill-emerald-50 stroke-emerald-200 dark:fill-emerald-950/60 dark:stroke-emerald-800" />
    <text x="154" y="50" font-size="8" font-weight="600" class="fill-emerald-800 dark:fill-emerald-300">RayPDF record</text>
    {#each ['Saved 25 Oct 2026', 'ID 7f3a 91c2', 'Watermark: R. Doe'] as row, i (row)}
      <text x="154" y={64 + i * 12} font-size="7" class={MUTED}>{row}</text>
    {/each}
  {:else if kind === 'offline'}
    <rect x="24" y="14" width="192" height="122" rx="8" class={PAGE} stroke-width="1.5" />
    <line x1="24" y1="32" x2="216" y2="32" class="stroke-neutral-200 dark:stroke-neutral-700" />
    {#each [36, 46, 56] as cx (cx)}
      <circle {cx} cy="23" r="3" class="fill-neutral-300 dark:fill-neutral-600" />
    {/each}
    <rect x="70" y="18" width="120" height="10" rx="5" class="fill-neutral-100 dark:fill-neutral-700" />
    <g fill="none" stroke-width="3" stroke-linecap="round" class="stroke-neutral-400 dark:stroke-neutral-500">
      <path d="M98 74a32 32 0 0 1 44 0" />
      <path d="M105 81a22 22 0 0 1 30 0" />
      <path d="M112 88a12 12 0 0 1 16 0" />
      <path d="M102 62l36 40" class="stroke-amber-500" />
    </g>
    <circle cx="120" cy="95" r="2.5" class="fill-neutral-400 dark:fill-neutral-500" />
    <text x="120" y="122" text-anchor="middle" font-size="9" class={STRONG}>Works without a connection</text>
  {/if}
</svg>
