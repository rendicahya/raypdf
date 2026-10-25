<script lang="ts">
  // Front-page FAQ. Plain <details> elements: no script, keyboard
  // accessible, and each answer opens in place.

  interface Question {
    q: string;
    a: string[];
  }

  const questions: Question[] = [
    {
      q: 'Are my files uploaded anywhere?',
      a: [
        'No. RayPDF has no server. Your PDFs are opened, edited, and saved entirely inside your browser, and nothing is sent anywhere.',
      ],
    },
    {
      q: 'Is RayPDF free? Do I need an account?',
      a: ['It is free, with no account, no sign-up, and no limits on how many files you edit.'],
    },
    {
      q: 'Is a signature added with RayPDF legally binding?',
      a: [
        'RayPDF places an image of your handwritten signature, much like signing a printed page and scanning it. Whether that is accepted depends on where you are and who you send it to.',
        'It is not a certificate-based digital signature. If you need one, use a tool built on PKI.',
      ],
    },
    {
      q: 'What does the watermark on my signature do?',
      a: [
        'RayPDF writes details such as your name, the document name, and the date into the signature image itself. If someone copies the signature out of the PDF, those details come with it, so it is harder to reuse on another document unnoticed.',
        'You choose the text, position, size, and opacity in the Signature panel.',
      ],
    },
    {
      q: 'Where is my signature stored?',
      a: [
        "In your browser's own storage on this device, so it's ready next time. It isn't synced anywhere. Delete it from the Signature panel at any time; clearing your browser's site data removes it too.",
      ],
    },
    {
      q: 'Does redaction really remove the content?',
      a: [
        'Yes. When you save, the areas you redacted are removed from the file, not just covered with a black box, so the text underneath cannot be copied or recovered from the saved PDF.',
      ],
    },
    {
      q: 'Can I edit the text that is already in a PDF?',
      a: [
        'Not yet. You can add your own text boxes, fill in form fields, and highlight, underline, or strike through existing text. To change a few words, a text box with a white background placed over them works well.',
      ],
    },
    {
      q: 'How much smaller does "Save compressed" make a file?',
      a: [
        'It depends on what is inside. Scanned pages and photos usually shrink a lot, because images are scaled down and re-encoded. A PDF that is mostly text is often already compact and changes little. Text stays sharp and selectable either way.',
      ],
    },
    {
      q: 'Does it work offline?',
      a: [
        "Yes. After your first visit everything is saved by your browser, so RayPDF opens and works without a connection. You can also install it as an app from your browser's menu.",
      ],
    },
  ];
</script>

<section class="w-full" aria-labelledby="faq-heading">
  <h2 id="faq-heading" class="text-center text-2xl font-bold tracking-tight">Questions and answers</h2>
  <div
    class="mt-6 divide-y divide-neutral-200 rounded-2xl border border-neutral-200 bg-white shadow-sm
      dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900"
  >
    {#each questions as item (item.q)}
      <details class="group px-5">
        <summary
          class="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium
            [&::-webkit-details-marker]:hidden"
        >
          {item.q}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="h-4 w-4 shrink-0 text-neutral-400 transition-transform group-open:rotate-180"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div class="space-y-2 pb-4 text-sm text-neutral-600 dark:text-neutral-400">
          {#each item.a as paragraph}
            <p>{paragraph}</p>
          {/each}
        </div>
      </details>
    {/each}
  </div>
</section>
