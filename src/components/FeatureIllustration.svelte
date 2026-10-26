<script lang="ts" module>
  export type FeatureKind =
    | 'onePass'
    | 'forms'
    | 'markup'
    | 'redact'
    | 'pages'
    | 'find'
    | 'ocr'
    | 'screenshot'
    | 'save'
    | 'verify'
    | 'offline';
</script>

<script lang="ts">
  // Small decorative drawings for the front page's feature rows. Each one
  // shows the feature at a glance; the row's text says the same thing.
  // Hovering the row (.fi-host) plays a short animation of the feature; the
  // fi-* classes and their keyframes are in app.css.

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
  // When each One-go step starts, in seconds.
  const stepAt = (i: number) => 0.1 + i * 0.35;
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

  {#snippet arrow(d: string, delay: number)}
    <path
      {d}
      fill="none"
      stroke-width="1.5"
      marker-end="url(#{arrowId})"
      class="fi-fade {ARROW}"
      style:--d="{delay}s"
    />
  {/snippet}

  <defs>
    <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0 0l10 5-10 5z" class="fill-blue-500" />
    </marker>
  </defs>

  {#if kind === 'onePass'}
    <!-- Each step lights up and lands on the page in turn, then Save is pressed once. -->
    {#each ONE_PASS_STEPS as step, i (step.label)}
      {@const y = 16 + i * 30}
      <g class="fi-slide" style:--d="{stepAt(i)}s" style:--dx="-10px">
        <rect x="8" {y} width="82" height="20" rx="10" class={PAGE} stroke-width="1.5" />
        <circle cx="19" cy={y + 10} r="3" class={step.dot} />
        <text x="27" y={y + 13.5} font-size="9" class={STRONG}>{step.label}</text>
      </g>
      {@render arrow(`M92 ${y + 10}C108 ${y + 10} 106 73 120 73`, stepAt(i) + 0.15)}
    {/each}
    <g class="fi-press" style:--d="{stepAt(3) + 0.35}s" style:--t="0.4s">
      {@render page(124, 38, 52, 70)}
      {@render lines(132, 50, 36, 4, 9)}
      <rect
        x="132"
        y="84"
        width="26"
        height="5"
        rx="1"
        class="fi-grow fill-neutral-900 dark:fill-black"
        style:--d="{stepAt(1) + 0.35}s"
      />
      <path
        d={SIGNATURE}
        pathLength="1"
        transform="translate(134 86) scale(0.4)"
        fill="none"
        stroke-width="3"
        class="fi-draw {INK}"
        style:--d="{stepAt(0) + 0.35}s"
        style:--t="0.6s"
      />
      <text
        x="150"
        y="103"
        text-anchor="middle"
        font-size="6"
        class="fi-pop fill-teal-600 dark:fill-teal-400"
        style:--d="{stepAt(2) + 0.35}s"
      >
        1
      </text>
    </g>
    {@render arrow('M178 73h10', 1.85)}
    <g class="fi-press" style:--d="2.05s">
      <rect x="192" y="62" width="42" height="22" rx="11" class="fill-blue-600" />
      <text x="213" y="76.5" text-anchor="middle" font-size="9" font-weight="600" class="fill-white">Save</text>
    </g>
    <text x="213" y="98" text-anchor="middle" font-size="7" class="fi-fade {MUTED}" style:--d="2.3s">once</text>
  {:else if kind === 'forms'}
    <!-- A name is typed, the box ticked, and the dropdown picked. -->
    {@render page(60, 8, 120, 134)}
    <rect x="72" y="20" width="40" height="4" rx="2" class={LINE} />
    <rect x="72" y="28" width="96" height="18" rx="3" stroke-width="1.5" class="fill-white stroke-blue-400 dark:fill-neutral-900" />
    <text
      x="77"
      y="40.5"
      font-size="9"
      class="fi-type {STRONG}"
      style:--d="0.3s"
      style:--t="0.8s"
      style:--ease="steps(8, end)"
    >
      Jane Doe
    </text>
    <g class="fi-move" style:--d="0.3s" style:--t="0.8s" style:--ease="steps(8, end)" style:--dx="-42px">
      <line x1="119" y1="32" x2="119" y2="42" stroke-width="1" class="fi-blink stroke-blue-500" style:--d="1.1s" />
    </g>
    <g class="fi-pop" style:--d="1.25s">
      <rect x="72" y="56" width="10" height="10" rx="2" class="fill-blue-600 stroke-blue-600" />
      <path
        d="M74.5 61l2 2 3.5-4"
        pathLength="1"
        fill="none"
        stroke-width="1.5"
        stroke-linecap="round"
        class="fi-draw stroke-white"
        style:--d="1.4s"
        style:--t="0.3s"
      />
    </g>
    <rect x="88" y="59" width="60" height="4" rx="2" class={LINE} />
    <rect x="72" y="72" width="10" height="10" rx="2" class={FIELD} />
    <rect x="88" y="75" width="48" height="4" rx="2" class={LINE} />
    <rect x="72" y="90" width="36" height="4" rx="2" class={LINE} />
    <rect x="72" y="98" width="96" height="18" rx="3" class={FIELD} />
    <text x="77" y="110.5" font-size="9" class="fi-slide {STRONG}" style:--d="1.95s" style:--dy="-4px">
      Approved
    </text>
    <path
      d="M155 105l3 3 3-3"
      fill="none"
      stroke-width="1.5"
      stroke-linecap="round"
      class="fi-press stroke-neutral-400"
      style:--d="1.8s"
    />
    <line x1="72" y1="132" x2="140" y2="132" class="stroke-neutral-300 dark:stroke-neutral-600" />
  {:else if kind === 'markup'}
    <!-- Highlight, underline, strike through, a text box, then a sticky note. -->
    {@render page(20, 8, 150, 134)}
    <rect
      x="28"
      y="33"
      width="96"
      height="10"
      rx="2"
      class="fi-grow fill-yellow-300/80 dark:fill-yellow-400/50"
      style:--d="0.2s"
      style:--t="0.6s"
    />
    {@render lines(30, 24, 130, 5, 12)}
    <line x1="30" y1="55" x2="110" y2="55" stroke-width="1.2" class="fi-grow {INK}" style:--d="0.8s" style:--t="0.5s" />
    <line x1="60" y1="62" x2="140" y2="62" stroke-width="1.2" class="fi-grow {INK}" style:--d="1.1s" style:--t="0.5s" />
    <rect
      x="30"
      y="92"
      width="100"
      height="24"
      rx="3"
      fill="none"
      stroke-dasharray="4 3"
      class="fi-pop stroke-blue-500"
      style:--d="1.5s"
    />
    <text
      x="36"
      y="108"
      font-size="10"
      class="fi-type fill-blue-700 dark:fill-blue-300"
      style:--d="1.7s"
      style:--t="0.9s"
      style:--ease="steps(16, end)"
    >
      Approved, 25 Oct
    </text>
    <g class="fi-pop" style:--d="2.5s">
      <g transform="translate(176 26)">
        <rect width="50" height="50" rx="3" class="fill-amber-200 stroke-amber-300 dark:fill-amber-500/70 dark:stroke-amber-600" />
        <path d="M38 50l12-12H38z" class="fill-amber-300 dark:fill-amber-600" />
        {#each [10, 18, 26] as y (y)}
          <rect x="7" {y} width={y === 26 ? 22 : 36} height="3" rx="1.5" class="fill-amber-500/60" />
        {/each}
      </g>
    </g>
  {:else if kind === 'redact'}
    <!-- A box goes over the ID, and the saved page comes out with it removed. -->
    {#snippet redactPage(x: number)}
      {@render page(x, 14, 96, 122)}
      {@render lines(x + 10, 28, 76, 3, 10)}
      {@render lines(x + 10, 80, 76, 4, 10)}
    {/snippet}
    {@render redactPage(12)}
    <text x="22" y="68" font-size="7.5" class={STRONG}>ID 3271 0402 88</text>
    <rect
      x="20"
      y="60"
      width="80"
      height="12"
      rx="1"
      fill="none"
      stroke-width="1.2"
      stroke-dasharray="3 2"
      class="fi-grow stroke-neutral-900 dark:stroke-neutral-100"
      style:--d="0.2s"
      style:--t="0.5s"
    />
    {@render arrow('M112 75h14', 0.8)}
    <g class="fi-slide" style:--d="0.9s" style:--dx="-20px">
      {@render redactPage(132)}
      <rect
        x="140"
        y="60"
        width="80"
        height="12"
        rx="1"
        class="fi-grow fill-neutral-900 dark:fill-black"
        style:--d="1.35s"
        style:--t="0.5s"
      />
    </g>
    <text x="60" y="147" text-anchor="middle" font-size="8" class={MUTED}>before</text>
    <text
      x="180"
      y="147"
      text-anchor="middle"
      font-size="8"
      class="fi-fade fill-emerald-600 dark:fill-emerald-400"
      style:--d="1.9s"
    >
      saved: text removed
    </text>
  {:else if kind === 'pages'}
    <!-- Page 3 is dragged from the end to between 2 and 4, and page 4 makes room. -->
    {#each [{ x: 14, n: 1 }, { x: 72, n: 2 }, { x: 188, n: 4 }] as thumb (thumb.n)}
      <g class={thumb.n === 4 ? 'fi-move' : undefined} style:--d="0.5s" style:--t="0.6s" style:--dx="-58px">
        {@render page(thumb.x, 50, 44, 58)}
        {@render lines(thumb.x + 7, 59, 30, 3, 7)}
        <text x={thumb.x + 22} y="102" text-anchor="middle" font-size="7" class="fill-teal-600 dark:fill-teal-400">
          {thumb.n}
        </text>
      </g>
    {/each}
    <rect
      x="130"
      y="50"
      width="44"
      height="58"
      rx="6"
      fill="none"
      stroke-dasharray="4 3"
      class="fi-fade stroke-neutral-300 dark:stroke-neutral-600"
      style:--d="0.9s"
    />
    <g class="fi-move" style:--d="0.3s" style:--t="0.8s" style:--dx="70px" style:--dy="36px">
      <g transform="translate(118 14) rotate(-8 22 29)">
        <rect x="3" y="4" width="44" height="58" rx="6" class="fill-neutral-900/10" />
        <rect width="44" height="58" rx="6" stroke-width="1.5" class="fill-white stroke-blue-500 dark:fill-neutral-800" />
        {@render lines(7, 9, 30, 3, 7)}
        <text x="22" y="52" text-anchor="middle" font-size="7" class="fill-teal-600 dark:fill-teal-400">3</text>
      </g>
    </g>
    {@render arrow('M168 44c8 4 6 10 0 14', 1.15)}
    <text x="120" y="130" text-anchor="middle" font-size="8" class="fi-fade {MUTED}" style:--d="1.3s">
      drag to reorder
    </text>
  {:else if kind === 'find'}
    <!-- The search is typed, matches light up, and the current one is marked. -->
    <rect x="50" y="8" width="140" height="20" rx="10" class={FIELD} />
    <circle cx="62" cy="18" r="4" fill="none" stroke-width="1.5" class="stroke-neutral-400" />
    <path d="M65 21l3 3" stroke-width="1.5" stroke-linecap="round" class="stroke-neutral-400" />
    <text
      x="72"
      y="21.5"
      font-size="9"
      class="fi-type {STRONG}"
      style:--d="0.1s"
      style:--t="0.7s"
      style:--ease="steps(7, end)"
    >
      invoice
    </text>
    <text x="182" y="21.5" text-anchor="end" font-size="8" class="fi-fade {MUTED}" style:--d="1s">2 / 5</text>
    {@render page(30, 36, 180, 108)}
    {@render lines(42, 50, 156, 7, 12)}
    {#each [{ x: 60, y: 47 }, { x: 150, y: 59 }, { x: 80, y: 95 }, { x: 130, y: 119 }] as match, i (match.x)}
      <rect
        x={match.x}
        y={match.y}
        width="30"
        height="10"
        rx="2"
        class="fi-pop fill-amber-300/70 dark:fill-amber-400/50"
        style:--d="{0.9 + i * 0.12}s"
      />
    {/each}
    <rect
      x="120"
      y="71"
      width="30"
      height="10"
      rx="2"
      stroke-width="1.2"
      class="fi-pop fill-orange-400/60 stroke-orange-500"
      style:--d="1.6s"
    />
  {:else if kind === 'ocr'}
    <!-- The scan is read top to bottom, and comes out as text that can be selected and copied. -->
    <rect x="14" y="14" width="96" height="122" rx="6" stroke-width="1.5" class="fill-stone-100 stroke-stone-300 dark:fill-neutral-700 dark:stroke-neutral-600" />
    <g transform="rotate(-1.5 62 75)">
      <text x="24" y="34" font-size="9" font-family="Georgia, serif" class="fill-neutral-600 dark:fill-neutral-300">
        Invoice 4471
      </text>
      {#each { length: 6 } as _, i}
        <rect x="24" y={44 + i * 11} width={i === 5 ? 44 : 76} height="4" rx="1" class="fill-neutral-400/70 dark:fill-neutral-500" />
      {/each}
    </g>
    <g class="fi-gone fi-out" style:--d="0.1s" style:--t="1.1s">
      <g class="fi-move" style:--d="0.1s" style:--t="1s" style:--ease="ease-in-out" style:--dy="-112px">
        <rect x="15" y="118" width="94" height="14" class="fill-blue-500/15" />
        <line x1="15" y1="132" x2="109" y2="132" stroke-width="1.5" class="stroke-blue-500" />
      </g>
    </g>
    {@render arrow('M114 75h12', 1.15)}
    <g class="fi-slide" style:--d="1.25s" style:--dx="-14px">
      {@render page(130, 14, 96, 122)}
      <rect x="138" y="26" width="64" height="11" rx="2" class="fi-grow fill-blue-400/30" style:--d="1.75s" style:--t="0.35s" />
      <text x="140" y="34" font-size="9" class={STRONG}>Invoice 4471</text>
      {@render lines(140, 44, 76, 6, 11)}
      <rect x="138" y="42" width="80" height="8" rx="2" class="fi-grow fill-blue-400/30" style:--d="2s" style:--t="0.35s" />
      {#each ['Find', 'Copy'] as chip, i (chip)}
        <g class="fi-pop" style:--d="{2.4 + i * 0.1}s">
          <rect
            x={140 + i * 40}
            y="112"
            width="34"
            height="15"
            rx="7.5"
            class="fill-blue-50 stroke-blue-200 dark:fill-blue-950 dark:stroke-blue-900"
          />
          <text x={157 + i * 40} y="122.5" text-anchor="middle" font-size="7" class="fill-blue-700 dark:fill-blue-300">
            {chip}
          </text>
        </g>
      {/each}
    </g>
    <text x="62" y="147" text-anchor="middle" font-size="8" class={MUTED}>scan</text>
    <text x="178" y="147" text-anchor="middle" font-size="8" class="fi-fade fill-emerald-600 dark:fill-emerald-400" style:--d="2.2s">
      text you can find
    </text>
  {:else if kind === 'screenshot'}
    <!-- An area is dragged out over the page, flashes, and lands on the clipboard. -->
    {@render page(16, 10, 110, 130)}
    {@render lines(28, 24, 86, 4, 10)}
    <path
      d={SIGNATURE}
      transform="translate(36 68) scale(0.8)"
      fill="none"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={INK}
    />
    {@render lines(28, 106, 86, 3, 10)}
    <rect
      x="26"
      y="64"
      width="80"
      height="32"
      stroke-dasharray="3 2"
      class="fi-sweep fill-blue-500/10 stroke-blue-500"
      style:--d="0.3s"
      style:--t="0.7s"
    />
    <rect x="26" y="64" width="80" height="32" class="fi-gone fi-out fill-white" style:--d="1s" style:--t="0.3s" />
    <!-- The crosshair drags from the top-left corner to the bottom-right. -->
    <g class="fi-move" style:--d="0.3s" style:--t="0.7s" style:--dx="-80px" style:--dy="-32px">
      <path d="M106 90v12M100 96h12" stroke-width="1.5" class={INK} />
    </g>
    {@render arrow('M112 80C126 80 130 64 144 64', 1.1)}
    <g class="fi-fly" style:--d="1.1s" style:--t="0.8s" style:--dx="-122px" style:--dy="16px">
      <rect x="150" y="51" width="80" height="32" rx="3" class="fill-neutral-900/10" />
      <rect x="148" y="48" width="80" height="32" rx="3" stroke-width="1.5" class="fill-white stroke-blue-500 dark:fill-neutral-800" />
      <path
        d={SIGNATURE}
        transform="translate(158 52) scale(0.8)"
        fill="none"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class={INK}
      />
    </g>
    <text x="188" y="98" text-anchor="middle" font-size="8" class="fi-fade {MUTED}" style:--d="1.9s">
      Copied to clipboard
    </text>
    {#each ['Save PNG', 'Up to 4×'] as chip, i (chip)}
      <g class="fi-pop" style:--d="{2.1 + i * 0.1}s">
        <rect
          x={148 + i * 42}
          y="106"
          width="38"
          height="15"
          rx="7.5"
          class="fill-blue-50 stroke-blue-200 dark:fill-blue-950 dark:stroke-blue-900"
        />
        <text
          x={167 + i * 42}
          y="116.5"
          text-anchor="middle"
          font-size="7"
          class="fill-blue-700 dark:fill-blue-300"
        >
          {chip}
        </text>
      </g>
    {/each}
  {:else if kind === 'save'}
    <!-- One PDF fans out to each way of saving it. -->
    <g class="fi-pop">
      {@render page(14, 38, 60, 76)}
      {@render lines(24, 50, 40, 3, 8)}
      <text x="44" y="98" text-anchor="middle" font-size="11" font-weight="700" class="fill-blue-600 dark:fill-blue-400">
        PDF
      </text>
    </g>
    {#each SAVE_OPTIONS as option, i (option)}
      {@const y = 10 + i * 34}
      {@render arrow(`M76 76C98 76 98 ${y + 11} 118 ${y + 11}`, 0.35 + i * 0.25)}
      <g class="fi-slide" style:--d="{0.45 + i * 0.25}s" style:--dx="-12px">
        <rect x="122" {y} width="106" height="22" rx="6" class={PAGE} stroke-width="1.5" />
        <circle cx="134" cy={y + 11} r="3" class="fill-blue-500" />
        <text x="143" y={y + 14.5} font-size="9" class={STRONG}>{option}</text>
      </g>
    {/each}
  {:else if kind === 'verify'}
    <!-- The signed page is checked, and its record slides out. -->
    {@render page(24, 12, 104, 128)}
    {@render lines(36, 28, 80, 6, 10)}
    <path
      d={SIGNATURE}
      pathLength="1"
      transform="translate(40 96) scale(0.9)"
      fill="none"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="fi-draw {INK}"
      style:--d="0.1s"
    />
    <g class="fi-pop" style:--d="1.1s">
      <g transform="translate(124 118)">
        <circle r="14" class="fill-emerald-500" />
        <path
          d="M-6 0l4 4 8-8"
          pathLength="1"
          fill="none"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="fi-draw stroke-white"
          style:--d="1.3s"
          style:--t="0.35s"
        />
      </g>
    </g>
    <g class="fi-slide" style:--d="1.6s" style:--dx="-12px">
      <rect x="146" y="34" width="86" height="72" rx="6" class="fill-emerald-50 stroke-emerald-200 dark:fill-emerald-950/60 dark:stroke-emerald-800" />
      <text x="154" y="50" font-size="8" font-weight="600" class="fill-emerald-800 dark:fill-emerald-300">RayPDF record</text>
      {#each ['Saved 25 Oct 2026', 'ID 7f3a 91c2', 'Watermark: R. Doe'] as row, i (row)}
        <text x="154" y={64 + i * 12} font-size="7" class="fi-fade {MUTED}" style:--d="{1.9 + i * 0.15}s">{row}</text>
      {/each}
    </g>
  {:else if kind === 'offline'}
    <!-- The signal drops out, and the app keeps working. -->
    <rect x="24" y="14" width="192" height="122" rx="8" class={PAGE} stroke-width="1.5" />
    <line x1="24" y1="32" x2="216" y2="32" class="stroke-neutral-200 dark:stroke-neutral-700" />
    {#each [36, 46, 56] as cx (cx)}
      <circle {cx} cy="23" r="3" class="fill-neutral-300 dark:fill-neutral-600" />
    {/each}
    <rect x="70" y="18" width="120" height="10" rx="5" class="fill-neutral-100 dark:fill-neutral-700" />
    <g fill="none" stroke-width="3" stroke-linecap="round" class="stroke-neutral-400 dark:stroke-neutral-500">
      <path d="M98 74a32 32 0 0 1 44 0" class="fi-fade" style:--d="0.5s" />
      <path d="M105 81a22 22 0 0 1 30 0" class="fi-fade" style:--d="0.3s" />
      <path d="M112 88a12 12 0 0 1 16 0" class="fi-fade" style:--d="0.1s" />
      <path d="M102 62l36 40" pathLength="1" class="fi-draw stroke-amber-500" style:--d="1s" style:--t="0.4s" />
    </g>
    <circle cx="120" cy="95" r="2.5" class="fi-pop fill-neutral-400 dark:fill-neutral-500" />
    <text x="120" y="122" text-anchor="middle" font-size="9" class="fi-fade {STRONG}" style:--d="1.5s">
      Works without a connection
    </text>
  {/if}
</svg>
