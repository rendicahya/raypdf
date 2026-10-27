<script lang="ts">
  import WatermarkIllustration from './WatermarkIllustration.svelte';
  import FeatureIllustration, { type FeatureKind } from './FeatureIllustration.svelte';

  // The front page's feature showcase, one row per feature. Purely
  // informational: everything here happens in the editor (or the Verify
  // choice) once a PDF is added.

  interface Feature {
    kind: FeatureKind | 'watermark';
    title: string;
    description: string;
    points: string[];
    // What the illustration shows, for screen readers.
    illustration: string;
    // SVG path data for a 24x24 stroked icon.
    paths: string[];
    highlight?: boolean;
  }

  const features: Feature[] = [
    {
      kind: 'watermark',
      title: 'Sign, with signatures that are hard to reuse',
      description:
        "Draw your signature with a mouse, finger, or pen, type it in a handwriting font, or upload a scan, then drag it onto the page. RayPDF weaves a watermark into the signature image, such as your name, the document name, and the date. A signature copied out of one PDF carries that document's details with it, so it's harder to paste into another.",
      points: [
        'Your signatures are kept on this device, so next time you only add the PDF.',
        'Keep several, such as a full signature and your initials.',
        'Move, resize, and rotate it, reuse the last position, or put it on every page or every open document in one click.',
        'Choose the watermark text, add the date and time, and set its position, color, size, and opacity.',
        'Save the watermark texts you use often and reuse them in one click.',
      ],
      illustration: 'A signature copied from Contract.pdf into Invoice.pdf still shows Contract.pdf in its watermark',
      paths: ['M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3z', 'M9 13c1-2 2-2 3 0s2 2 3 0'],
      highlight: true,
    },
    {
      kind: 'onePass',
      title: 'Everything in one go',
      description:
        'Many online PDF tools do one job per visit: upload, process, download, then upload the result again for the next job. In RayPDF you sign, fill, redact, number the pages, and compress the same open document, then save once at the end.',
      points: [
        'Every change can be undone until you save.',
        'Nothing is uploaded, so there is no waiting on a server between steps.',
        'Work on several PDFs side by side in tabs.',
      ],
      illustration: 'Signing, redacting, page numbers, and compression all go into one document, saved once',
      paths: ['M4 6h16', 'M4 12h16', 'M4 18h10', 'M17 16l2 2 3-4'],
      highlight: true,
    },
    {
      kind: 'forms',
      title: 'Fill forms',
      description:
        "If the PDF has its own form fields, type straight into them on the page. Your answers go into the real fields, so the saved file is still a normal fillable form.",
      points: [
        'Text fields, checkboxes, radio buttons, and dropdowns.',
        'No form fields? Add a text box anywhere instead.',
      ],
      illustration: 'A form with a filled text field, a ticked checkbox, and a dropdown',
      paths: ['M5 4h14v16H5z', 'M8 9h8', 'M8 13h8', 'M8 17h4'],
    },
    {
      kind: 'markup',
      title: 'Mark up',
      description:
        'Select text to highlight it, underline it, strike it through, or comment on it. Add text boxes in the font and size you want, draw rectangles, circles, lines, and arrows, place images or a logo, and leave comments as sticky notes.',
      points: [
        'Highlights come in five colors.',
        'Shapes and images can be moved, resized, and restyled at any time before you save.',
        'Markups and comments are saved as real PDF annotations that other PDF readers show.',
        'Text boxes support bold, italic, alignment, spacing, and a background color.',
      ],
      illustration: 'A page with highlighted, underlined, and struck-through text, a text box, and a sticky note',
      paths: ['M9 11l-5 5v4h4l5-5', 'M14 6l4 4', 'M12 8l5-5 4 4-5 5'],
    },
    {
      kind: 'redact',
      title: 'Redact',
      description:
        'Draw a box over anything private. When you save, what is under the box is removed from the file, not just hidden behind black, so it cannot be copied or recovered.',
      points: [
        'Copy a box to the same spot on every page.',
        'See every redaction in a list and jump to it.',
        'Give every open document the same redactions.',
      ],
      illustration: 'A box drawn over an ID number on a page, then the saved page with the number blacked out and removed',
      paths: ['M4 6h16v4H4z', 'M4 14h10v4H4z'],
    },
    {
      kind: 'pages',
      title: 'Edit pages',
      description:
        'Drag thumbnails to reorder pages. Rotate, move, duplicate, insert a blank page, or delete, one page at a time or a whole selection, and crop pages. Add page numbers, a header, and a footer in the position and style you like, or stamp a watermark across every page.',
      points: [
        'Page numbers can skip a cover page and start at any number.',
        'Headers and footers can show the page number, page count, date, and file name.',
        'Watermark with a word like CONFIDENTIAL or your logo, once in the middle or tiled.',
        'Crop to a frame you draw, or to the content without its blank margins.',
        'Everything you placed moves with its page.',
        'Every edit can be undone.',
      ],
      illustration: 'Numbered page thumbnails, with page 3 being dragged into place',
      paths: ['M8 4h10v13H8z', 'M5 7v13h10'],
    },
    {
      kind: 'find',
      title: 'Find text',
      description:
        'Press Ctrl+F to search every page at once. Matches are counted, marked on the page, and stepped through with Enter.',
      points: [
        'Matching ignores case and line breaks.',
        'Select found text to copy or highlight it.',
        'A scan with nothing found? Recognize its text and search again.',
      ],
      illustration: 'A search for "invoice" showing match 2 of 5 marked on the page',
      paths: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4'],
    },
    {
      kind: 'ocr',
      title: 'Recognize text in scans',
      description:
        "A scanned page is only a picture, so there's nothing to find or copy. Recognize text reads the words on it (OCR) and adds them to the page as invisible text, right where they are. The page looks the same, but now you can search it, select the text, and copy it.",
      points: [
        'Runs in your browser like everything else, so the scan never leaves this device.',
        'Recognize every scanned page at once, or only the pages you pick.',
        'Or drag a rectangle around any text, even a photo in a typed page, and copy what it reads.',
        'The text is saved into the PDF, so other PDF readers can search it too.',
        'Reads English, Indonesian, Malay, Dutch, French, German, Italian, Portuguese, and Spanish. A few MB is downloaded the first time, and after that it works offline.',
      ],
      illustration: 'A scanned page read from top to bottom, then the same page with its text selected, ready to find or copy',
      paths: [
        'M4 8V5a1 1 0 0 1 1-1h3',
        'M16 4h3a1 1 0 0 1 1 1v3',
        'M20 16v3a1 1 0 0 1-1 1h-3',
        'M8 20H5a1 1 0 0 1-1-1v-3',
        'M8 9h8',
        'M8 12h8',
        'M8 15h5',
      ],
    },
    {
      kind: 'screenshot',
      title: 'Screenshots',
      description:
        'Click a page to capture all of it, or drag a rectangle to capture just an area. The image is copied to the clipboard, ready to paste into a message or another document.',
      points: [
        'Save it as a PNG instead, at up to four times the screen resolution.',
        'Includes your signatures, text, highlights, shapes, images, redactions, and form answers, or leave them out.',
      ],
      illustration: 'An area of a page dragged out and copied to the clipboard as an image',
      paths: ['M4 8V5a1 1 0 0 1 1-1h3', 'M16 4h3a1 1 0 0 1 1 1v3', 'M20 16v3a1 1 0 0 1-1 1h-3', 'M8 20H5a1 1 0 0 1-1-1v-3'],
    },
    {
      kind: 'save',
      title: 'Save your way',
      description:
        'Save the whole document, just the current page, or each page as its own PDF. Compress large scans, save several documents at once, merge them in the order you choose, or print.',
      points: [
        'Save pages as PNG or JPG images.',
        'Turn a PDF into an editable Word document.',
        'Save the pictures in a PDF at full resolution: right-click one, or save them all.',
        'Protect the saved PDF with a password, or open a protected one and save it without.',
        'Optionally remove embedded JavaScript or lock copying.',
        'Compression never makes a file bigger.',
      ],
      illustration: 'One PDF saved as a compressed file, one file per page, a merged file, or printed',
      paths: ['M12 4v11m0 0-4-4m4 4 4-4', 'M5 20h14'],
    },
    {
      kind: 'verify',
      title: 'Verify',
      description:
        'Every PDF saved with RayPDF carries a small record in its metadata. Add a PDF here and choose Verify to see when it was saved and which watermark its signature used.',
      points: [
        'Check several PDFs at once.',
        'This shows where a file came from. It does not prove the pages are unchanged since.',
      ],
      illustration: 'A signed PDF with a check mark and its RayPDF record',
      paths: ['M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3z', 'M8.5 12l2.5 2.5 4.5-5'],
    },
    {
      kind: 'offline',
      title: 'Works offline',
      description:
        "After your first visit, RayPDF works without a connection. Install it from your browser's menu and it opens like any other app.",
      points: [
        'Your files and signature never leave this device.',
        'Updates wait until you choose to reload, so work in progress is never interrupted.',
      ],
      illustration: 'A browser window with no connection, still working',
      paths: ['M12 3v12m0 0-4-4m4 4 4-4', 'M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4'],
    },
  ];

  // Everything else the editor does, too small for a row of its own.
  const extras = [
    'Undo and redo every change until you save.',
    'Open several PDFs at once, each in its own tab.',
    'Drop files anywhere on the page to add them.',
    'Zoom in and out, fit the width or the whole page, and rotate the view.',
    'Page thumbnails in a sidebar you can resize.',
    "Select and copy the PDF's own text.",
    "Right-click menus that fit what's under the pointer.",
    'Keyboard shortcuts for undo, search, pages, and tools.',
    'Dark mode and fullscreen.',
  ];
</script>

<section class="w-full">
  <ul class="flex flex-col gap-4">
    {#each features as feature, i (feature.title)}
      <li
        class="fi-host grid items-center gap-6 rounded-2xl border p-6 shadow-sm sm:grid-cols-2
          {feature.highlight
          ? 'border-blue-200 bg-gradient-to-br from-white to-blue-50 dark:border-blue-900 dark:from-neutral-900 dark:to-blue-950/60'
          : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'}"
      >
        <div
          class="rounded-xl p-4 {feature.highlight
            ? 'bg-white/70 dark:bg-neutral-950/40'
            : 'bg-neutral-50 dark:bg-neutral-950/50'} {i % 2 === 1 ? 'sm:order-last' : ''}"
        >
          {#if feature.kind === 'watermark'}
            <WatermarkIllustration label={feature.illustration} />
          {:else}
            <FeatureIllustration kind={feature.kind} label={feature.illustration} />
          {/if}
        </div>
        <div>
          <div class="flex items-center gap-3">
            <div
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600
                dark:bg-blue-950 dark:text-blue-400"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5">
                {#each feature.paths as d}
                  <path stroke-linecap="round" stroke-linejoin="round" {d} />
                {/each}
              </svg>
            </div>
            <h3 class="text-lg font-semibold">{feature.title}</h3>
          </div>
          <p class="mt-3 text-sm text-neutral-600 dark:text-neutral-400">{feature.description}</p>
          <ul class="mt-3 space-y-1.5 text-sm text-neutral-500 dark:text-neutral-400">
            {#each feature.points as point (point)}
              <li class="flex gap-2">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  class="mt-0.5 h-4 w-4 shrink-0 text-blue-500"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 12l5 5 9-10" />
                </svg>
                {point}
              </li>
            {/each}
          </ul>
        </div>
      </li>
    {/each}
  </ul>

  <div
    class="mt-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800
      dark:bg-neutral-900"
  >
    <h3 class="text-lg font-semibold">Also in RayPDF</h3>
    <ul class="mt-3 grid gap-x-6 gap-y-1.5 text-sm text-neutral-500 sm:grid-cols-2 dark:text-neutral-400">
      {#each extras as extra (extra)}
        <li class="flex gap-2">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            class="mt-0.5 h-4 w-4 shrink-0 text-blue-500"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 12l5 5 9-10" />
          </svg>
          {extra}
        </li>
      {/each}
    </ul>
  </div>
</section>
