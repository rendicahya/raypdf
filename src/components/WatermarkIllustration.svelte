<script lang="ts">
  // Front-page illustration for the watermarked signature: a signature
  // signed into one PDF, then copied into another, still carrying the first
  // document's details. Decorative; the card's text says the same thing.

  const WATERMARK = 'R. Doe · Contract.pdf · 25 Oct';
  const SIGNATURE = 'M2 22c6-14 10-20 13-14s-6 18-2 16 8-16 12-14-2 12 2 12 6-10 9-9 0 8 4 8 9-6 14-8 10-2 14-3';

  const docs = [
    { x: 8, title: 'Contract.pdf', clip: 'wm-clip-a' },
    { x: 222, title: 'Invoice.pdf', clip: 'wm-clip-b' },
  ];
</script>

<svg viewBox="0 0 360 168" class="h-auto w-full" role="img" aria-label="A signature copied from Contract.pdf into Invoice.pdf still shows Contract.pdf in its watermark">
  <defs>
    {#each docs as doc}
      <clipPath id={doc.clip}>
        <rect x={doc.x + 14} y="100" width="102" height="44" rx="4" />
      </clipPath>
    {/each}
    <marker id="wm-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0 0l10 5-10 5z" class="fill-blue-500" />
    </marker>
  </defs>

  {#each docs as doc, i}
    <g>
      <!-- the page -->
      <rect
        x={doc.x}
        y="8"
        width="130"
        height="152"
        rx="8"
        class="fill-white stroke-neutral-200 dark:fill-neutral-800 dark:stroke-neutral-700"
        stroke-width="1.5"
      />
      <text x={doc.x + 14} y="28" class="fill-neutral-700 dark:fill-neutral-200" font-size="10" font-weight="600">
        {doc.title}
      </text>
      <!-- body text -->
      {#each [40, 50, 60, 70, 80] as y, line}
        <rect
          x={doc.x + 14}
          {y}
          width={line === 4 ? 60 : 102}
          height="4"
          rx="2"
          class="fill-neutral-200 dark:fill-neutral-700"
        />
      {/each}

      <!-- the signature, with the watermark woven through it; on hover the
           first is signed and watermarked, then copied across to the second -->
      <g class={i === 1 ? 'fi-fly' : undefined} style:--d="1.7s" style:--dx="-214px">
        <rect
          x={doc.x + 14}
          y="100"
          width="102"
          height="44"
          rx="4"
          class={i === 0
            ? 'fill-blue-50 stroke-blue-200 dark:fill-blue-950/60 dark:stroke-blue-900'
            : 'fill-amber-50 stroke-amber-300 dark:fill-amber-950/50 dark:stroke-amber-700'}
          stroke-width="1"
        />
        <g clip-path="url(#{doc.clip})">
          <g class={i === 0 ? 'fi-fade' : undefined} style:--d="1.2s" style:--t="0.6s">
            {#each [-1, 0, 1, 2, 3, 4, 5] as row}
              <text
                x={doc.x + 4}
                y={104 + row * 10}
                font-size="6"
                transform="rotate(-10 {doc.x + 65} 122)"
                class="fill-blue-500/50 dark:fill-blue-400/50"
              >
                {WATERMARK} · {WATERMARK}
              </text>
            {/each}
          </g>
        </g>
        <path
          d={SIGNATURE}
          pathLength="1"
          transform="translate({doc.x + 24} 106) scale(1.1)"
          fill="none"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="{i === 0 ? 'fi-draw' : ''} stroke-neutral-900 dark:stroke-neutral-100"
          style:--d="0.2s"
          style:--t="1s"
        />
      </g>
      <line
        x1={doc.x + 20}
        y1="140"
        x2={doc.x + 110}
        y2="140"
        stroke-width="1"
        class="stroke-neutral-300 dark:stroke-neutral-600"
      />
    </g>
  {/each}

  <!-- copied across -->
  <path
    d="M146 122c26-30 50-30 72 0"
    fill="none"
    stroke-width="2"
    stroke-dasharray="4 4"
    marker-end="url(#wm-arrow)"
    class="fi-fade stroke-blue-500"
    style:--d="1.6s"
  />
  <text x="180" y="88" text-anchor="middle" font-size="9" class="fi-fade fill-neutral-500 dark:fill-neutral-400" style:--d="1.6s">
    copied
  </text>

  <!-- the giveaway -->
  <g class="fi-pop" style:--d="2.8s">
    <g transform="translate(336 98)">
      <circle r="10" class="fill-amber-500" />
      <path d="M0-5v6M0 4.5v.5" stroke="white" stroke-width="2" stroke-linecap="round" />
    </g>
  </g>
  <text
    x="287"
    y="156"
    text-anchor="middle"
    font-size="8"
    class="fi-fade fill-amber-700 dark:fill-amber-400"
    style:--d="3s"
  >
    still says Contract.pdf
  </text>
</svg>
