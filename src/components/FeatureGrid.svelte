<script lang="ts">
  import WatermarkIllustration from './WatermarkIllustration.svelte';

  // The front page's feature showcase. Purely informational: everything here
  // happens in the editor (or the Verify choice) once a PDF is added.

  interface Feature {
    title: string;
    description: string;
    // SVG path data for a 24x24 stroked icon.
    paths: string[];
  }

  const features: Feature[] = [
    {
      title: 'Sign',
      description: 'Draw, type, or upload a signature. Keep several, and drag any of them onto the page.',
      paths: ['M4 20l4-1 10-10a2.121 2.121 0 0 0-3-3L5 16l-1 4z', 'M13 7l3 3'],
    },
    {
      title: 'Fill forms',
      description: "Type into a PDF's own fields, checkboxes, and dropdowns. It stays a normal fillable form.",
      paths: ['M5 4h14v16H5z', 'M8 9h8', 'M8 13h8', 'M8 17h4'],
    },
    {
      title: 'Mark up',
      description: 'Highlight, underline, or strike through text in five colors, and add text boxes and comments.',
      paths: ['M9 11l-5 5v4h4l5-5', 'M14 6l4 4', 'M12 8l5-5 4 4-5 5'],
    },
    {
      title: 'Redact',
      description: 'Black out sensitive areas. The content underneath is removed from the file, not just covered.',
      paths: ['M4 6h16v4H4z', 'M4 14h10v4H4z'],
    },
    {
      title: 'Edit pages',
      description: 'Reorder pages by dragging, and rotate, duplicate, insert, or delete them. Every edit can be undone.',
      paths: ['M8 4h10v13H8z', 'M5 7v13h10'],
    },
    {
      title: 'Find text',
      description: 'Search every page with Ctrl+F. Matches are counted and highlighted as you step through them.',
      paths: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4'],
    },
    {
      title: 'Save your way',
      description: 'Save one page, split into separate pages, zip several PDFs, merge them in any order, or print.',
      paths: ['M12 4v11m0 0-4-4m4 4 4-4', 'M5 20h14'],
    },
    {
      title: 'Verify',
      description: 'Every saved PDF carries a small record. Add it back here to see when it was signed and which watermark it used.',
      paths: ['M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3z', 'M8.5 12l2.5 2.5 4.5-5'],
    },
    {
      title: 'Works offline',
      description: 'Install it as an app. After the first visit, everything works without a connection.',
      paths: ['M12 3v12m0 0-4-4m4 4 4-4', 'M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4'],
    },
  ];
</script>

<section class="w-full">
  <!-- The headline feature gets its own wide card above the grid. -->
  <div
    class="flex flex-col gap-4 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6
      shadow-sm sm:flex-row sm:items-center dark:border-blue-900 dark:from-blue-950/60 dark:to-neutral-900"
  >
    <div
      class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white
        shadow-md shadow-blue-600/25"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-6 w-6">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 13c1-2 2-2 3 0s2 2 3 0" />
      </svg>
    </div>
    <div class="flex-1">
      <h2 class="text-lg font-semibold">Signatures that are hard to reuse</h2>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        RayPDF weaves a watermark into your signature image, such as your name, the document name, and the date.
        A signature copied out of one PDF carries that document's details with it, so it's harder to paste into
        another.
      </p>
    </div>
    <div class="w-full max-w-sm shrink-0 self-center sm:w-72 lg:w-80">
      <WatermarkIllustration />
    </div>
  </div>

  <ul class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {#each features as feature (feature.title)}
      <li
        class="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition-colors
          hover:border-blue-200 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-blue-900"
      >
        <div
          class="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600
            dark:bg-blue-950 dark:text-blue-400"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
            {#each feature.paths as d}
              <path stroke-linecap="round" stroke-linejoin="round" {d} />
            {/each}
          </svg>
        </div>
        <h3 class="mt-3 font-semibold">{feature.title}</h3>
        <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{feature.description}</p>
      </li>
    {/each}
  </ul>
</section>
