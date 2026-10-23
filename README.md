# Signy

Sign PDF documents with protected handwritten signatures, entirely in your browser.

No backend, no uploads, no accounts — everything runs client-side and works fully offline once loaded. A "100% local" badge on the landing screen says so before any file is touched.

Live at https://rendicahya.github.io/signy/

## What Signy is (and isn't)

Signy is a lightweight protection layer for organizations that still rely on scanned handwritten signature images. It binds the signature to the document it was used on with a watermark baked into the signature image, so it's harder to lift and reuse elsewhere.

It is **not** a replacement for PKI-based digital signatures.

### Principles

(Full version in [CLAUDE.md](CLAUDE.md).)

- **Privacy first.** Files are processed in the browser and never uploaded. No backend, database, authentication, or cloud storage.
- **Signature images live in IndexedDB only** — never `localStorage`. Small preferences (watermark text, toggles) use `localStorage`.
- **The watermark is part of the signature image**, never drawn onto the PDF page directly, so the protected signature is a single image.
- **Few clicks, no unnecessary dialogs.** The whole signing flow should take under a minute.
- **GitHub Pages compatible**, and works offline after the first load.

## Features

### Getting started

- Upload one or more PDFs (drag & drop anywhere on the page, or click to browse), then upload a signature image. Files are type- and size-checked (50 MB per PDF, 10 MB per signature).
- The signature is saved in IndexedDB, so returning users only need to upload a new PDF. It can be replaced or deleted at any time.

### Editor

- **Document tabs** for every open PDF, with a close-confirmation for unsaved work and a tab context menu. Add more PDFs any time.
- **Page sidebar** (toggle with `Ctrl+B`): thumbnails of every page, rendered as they scroll into view so long documents open quickly. Click to jump; **drag and drop to reorder pages**.
- **Page tools** on each thumbnail (on hover, and always on the current page): rotate that page left/right, duplicate it, insert a blank page after it, or delete it. These change the PDF itself; signatures, redactions, text, highlights, and comments follow their page, and every edit can be undone.
- **Fill in PDF forms**: a PDF's own text fields, checkboxes, radio buttons, and dropdowns can be filled in directly on the page. The values are written into the real fields on export, so the result is still a normal fillable form.
- **Floating toolbar** (icon-only, with instant tooltips):
  - Undo / Redo (`Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`)
  - Previous / next page and a page picker (`←` / `→`; `Ctrl+←` / `Ctrl+→` switches documents)
  - Zoom out / reset / in, fit width, fit page
  - Rotate left / right
  - Tools (`Esc` returns to Move):
    - **Move** — drag placed items around; drag the page background to pan. Hovering over text briefly switches to selection.
    - **Redact** — draw boxes; the content underneath is permanently removed from the exported PDF.
    - **Add Text** — click to place a text box (font, size, style, color, spacing, alignment).
    - **Comment** — click to leave a sticky note, exported as a real PDF annotation.
    - **Zoom** — click to zoom in at that spot, right-click to zoom out.
    - **Select** — select and copy the PDF's real text. After selecting, a **Highlight** button appears below the selection to highlight it permanently; the highlight is exported as a real PDF Highlight annotation. Click a highlight to select it, then remove it with its × button or `Delete`.
    - **Screenshot** — click a page to capture all of it, or drag a rectangle to capture an area. The image is copied to the clipboard, with a **Save PNG** option. Captures include placed signatures (with their watermark), text, highlights, redactions, and form values — everything except comments, which are notes rather than page content.
  - **Apply redaction to all documents** (when several PDFs are open).
- Dark mode (follows the OS by default) and fullscreen.

### Placing the signature

- Drag the signature from the right sidebar onto the page, or click it to place it. Click-to-place mode follows the cursor.
- Move and resize (aspect ratio locked); several signatures per document are supported. Selected items can be nudged with the arrow keys and removed with `Delete`.
- **Find Signature Spot** scans the page text for signature lines or labels ("Signature", "Tanda Tangan", "TTD") and suggests a spot — it never places anything without confirmation.
- **Use last position** re-applies the last placement (as a ratio of the page) to the current page.
- **Apply Signature to All N Pages** copies the current page's signature(s) to the same spot on every page.
- **Apply to All N Documents** places the signature on page 1 of every open single-page PDF.

### Visible watermark

- Multi-line custom text, plus an optional date & time stamp.
- 9-position picker, color, size, and opacity. Scroll the mouse wheel over the size and opacity sliders to adjust them.
- Live preview on the signature in both the sidebar and the page.
- Flattened into the signature image at export. Preferences persist across sessions.

### Export

- **Save This PDF**, **Save This Page Only**, **Save Each Page as Separate PDF (ZIP)**, **Save All (ZIP)**, **Merge** (choose the order), and **Print**.
- Exported as `original_filename_signed.pdf`.
- Optional: strip embedded JavaScript carried over from the source PDF, and lock text/content copying.
- Each export embeds a small Signy record (document ID, name, export time, watermark text) in the PDF's metadata.

### Verify

- The **Verify** page reads a PDF's Signy record back, showing whether and when it was exported by Signy. This confirms provenance, not that the pages are unchanged since — that's what the planned invisible watermark is for.

### Offline (PWA)

- A service worker precaches the app, including the pdf.js worker. New versions wait in the background until the user clicks **Reload to update**, so work in progress is never interrupted.

## Roadmap

- **Invisible watermark** — DWT/DCT-based payload (signer, document ID, timestamp, signature ID), implemented as a replaceable module independent of the visible watermark.
- Rotating a placed signature, and snapping it to page edges.
- Signature background removal.
- Automated tests (coordinate mapping in `lib/pdf/export.ts`, zoom rescaling in `stores/editor.ts`).

## Development

Stack: Svelte 5 + Vite + TypeScript (strict), Tailwind CSS, pdf.js, pdf-lib (`@cantoo/pdf-lib`), IndexedDB (via `idb`), JSZip.

```bash
npm install
npm run dev      # dev server
npm run check    # svelte-check type checking
npm run build    # production build into dist/
npm run deploy   # build and publish dist/ to the gh-pages branch
```

`vite.config.ts` sets `base: '/signy/'` in production builds — update `REPO_NAME` there if the repository is renamed.

Project guidelines — product vision, principles, UX rules, code structure, and workflow — live in [CLAUDE.md](CLAUDE.md). In short: run `npm run check` before committing, then push and `npm run deploy` after each change, and keep this README's feature list up to date.

### Layout

- `src/components/` — UI (`PDFViewer`, `PageSidebar`, `FloatingControls`, `SignaturePanel`, `ExportButton`, `DocumentTabs`, `VerifyPage`, …)
- `src/stores/` — app state (`editor.ts` holds documents, placements, and undo history; one small store per tool)
- `src/lib/pdf/` — loading, rendering, export, redaction, page operations, form filling, screenshots, verification
- `src/lib/watermark/` — visible watermark layout and rendering
- `src/lib/signature/` — signature storage and sizing
- `src/lib/utils/` — persistence, file validation, tooltip and other Svelte actions
