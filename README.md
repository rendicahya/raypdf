# RayPDF

A privacy-first PDF editor that runs entirely in your browser: sign with protected handwritten signatures, fill forms, mark up, redact, edit pages, and verify PDFs exported with RayPDF. Add a PDF, then choose **Open in editor** or **Verify**.

RayPDF was previously called Signy.

No backend, no uploads, no accounts. Everything runs client-side and works fully offline once loaded. A "100% local" badge on the landing screen says so before any file is touched.

Live at https://rendicahya.github.io/raypdf/

## What RayPDF is (and isn't)

RayPDF's headline feature is a lightweight protection layer for organizations that still rely on scanned handwritten signature images. It binds the signature to the document it was used on with a watermark baked into the signature image, so it's harder to lift and reuse elsewhere.

It is **not** a replacement for PKI-based digital signatures.

### Principles

(Full version in [CLAUDE.md](CLAUDE.md).)

- **Privacy first.** Files are processed in the browser and never uploaded. No backend, database, authentication, or cloud storage.
- **Signature images live in IndexedDB only**, never `localStorage`. Small preferences (watermark text, toggles) use `localStorage`.
- **The watermark is part of the signature image**, never drawn onto the PDF page directly, so the protected signature is a single image.
- **Few clicks, no unnecessary dialogs.** The whole signing flow should take under a minute.
- **GitHub Pages compatible**, and works offline after the first load.

## Features

### Getting started

- The front page shows the upload area at the top, then a tour of every feature, one illustrated row each: the protected signature first (with an illustration of a copied signature giving itself away), then "Everything in one go" (several jobs on one document, saved once), then each tool. A short FAQ sits at the bottom.
- Upload one or more PDFs (drag & drop anywhere on the page, or click to browse). Files are type- and size-checked (50 MB per PDF, 10 MB per signature image).- Then choose what to do with them: **Open in editor** opens the editor (signing, form filling, markup, and redaction), **Verify** checks each PDF for a RayPDF record right on the front page.
- **Add a signature three ways:** draw it with a mouse, finger, or pen (pressure-sensitive, black or blue ink); type your name in one of four handwriting fonts (bundled, so this works offline); or upload a scan.
- **Keep several signatures**, say a full signature and your initials. All are saved in IndexedDB, so returning users only need to upload a new PDF. Click one to make it the one new placements use, or drag any of them straight onto the page; each placed signature remembers which one it is. Delete any of them at any time.

### Editor

- **Document tabs** for every open PDF, with a close-confirmation for unsaved work and a tab context menu. Drag tabs to reorder them (or use Ctrl+Shift+←/→, or Move left/right in the tab menu). Add more PDFs any time.
- **Continuous scrolling**: all pages sit in one column, so you can scroll from page to page. The page you're looking at (or last worked on) is the current page for the toolbar, the page picker, and the sidebar, and jumping to a page scrolls to it. Only pages near the view are drawn, so long documents stay quick.
- **Page sidebar** (toggle with `Ctrl+B`): thumbnails of every page, rendered as they scroll into view so long documents open quickly. Redaction boxes show on the thumbnails as you draw them. Click to jump; **drag and drop to reorder pages**.
- **Select several pages** with Ctrl/⌘-click, Shift-click for a range, the checkbox on each thumbnail, or Ctrl+A. A bar at the top of the sidebar then rotates, saves (as one PDF with just those pages), or deletes them all at once; `Delete` and `Esc` work too.
- **Right-click a thumbnail** for the page tools: on the whole selection if the page is part of it, otherwise on just that page (rotate left/right, move up/down, duplicate, insert a blank page after, save as PDF, PNG, or JPG, select, delete). Page edits change the PDF itself; signatures, redactions, text, highlights, and comments follow their page, and every edit can be undone. Images include everything added to the page except comments; several pages download as a ZIP.
- **Resize the sidebar** by dragging its right edge (or focusing it and using the arrow keys); double-click the edge to reset. The width is remembered, and thumbnails render sharper as it grows.
- **Right-click the document** for a menu that fits what's under the pointer: on the page, place the signature, add text or a comment right there, zoom, rotate the page, or copy it as an image; on selected text, copy, highlight, underline, or strike it through; on a markup, remove it (or change a highlight's color); on a placed signature, redaction, text box, or comment, edit or delete it.
- **Find in the document** with Ctrl+F (⌘F) or the search button: matches on every page are counted, highlighted on the page, and stepped through with Enter / Shift+Enter. Matching ignores case and treats line breaks as spaces.
- **Fill in PDF forms**: a PDF's own text fields, checkboxes, radio buttons, and dropdowns can be filled in directly on the page. The values are written into the real fields on export, so the result is still a normal fillable form.
- **Floating toolbar** (icon-only, with instant tooltips):
  - Undo / Redo (`Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`)
  - Previous / next page and a page picker (`←` / `→`; `Ctrl+←` / `Ctrl+→` switches documents)
  - Zoom out / reset / in, fit width, fit page
  - Rotate left / right
  - Tools (`Esc` returns to Move):
    - **Move**: drag placed items around; drag the page background to pan. Resting the pointer on text switches to text selection, which stays on while the pointer moves over text and turns back into the hand once it leaves.
    - **Signature**: opens the signature panel on the right (your signatures, placement helpers, watermark). The page still behaves like Move, so placed signatures can be dragged and resized. Turning the tool off, or `Esc`, closes the panel.
    - **Redact**: draw boxes; the content underneath is permanently removed from the exported PDF. Its options list every box by page: click to jump, remove one box, a whole page's, or all of them, or copy a box to the same spot on every other page. When several PDFs are open, **Apply to All Documents** makes every other open document's redactions match this one.
    - **Add Text**: click to place a text box. Its options restyle the selected box, or set the style for new ones when none is selected: font, size, bold, italic, underline, strikethrough, superscript and subscript (for the whole box), alignment, color, a background color (handy for covering text), letter spacing, word spacing, line spacing, and opacity, with a live sample. The saved PDF and screenshots match the editor.
    - **Comment**: click to leave a sticky note, exported as a real PDF annotation. Its options list every comment in the document; click one to jump to its page, or delete it.
    - **Zoom**: click to zoom in at that spot, right-click to zoom out.
    - **Select**: select and copy the PDF's real text. After selecting, a small toolbar appears below the selection to **highlight, underline, or strike through** the text permanently. Highlights come in five colors; underlines and strikethroughs are always black. Each is exported as a real PDF markup annotation (Highlight, Underline, StrikeOut). Click a markup to remove it (also `Delete`), or a highlight to recolor it. Its options pick the color for the next highlight.
    - **Screenshot**: click a page to capture all of it, or drag a rectangle to capture an area. By default the image is copied to the clipboard, with a **Save PNG** option. Captures include placed signatures (with their watermark), text, highlights, redactions, and form values, but not comments, which are notes rather than page content. Its options choose copy or download, the resolution (1× to 4×), and whether to include what you've added.
    - **Page numbers**: number the document's pages. Pick the position (top or bottom, left, center, or right), the format (1, Page 1, Page 1 of 9, 1 / 9, - 1 -), the starting number, the first page to number (to skip a cover), the font, size, distance from the edge, and color. The numbers show on the pages right away, stay upright on rotated pages, and are added when you save, print, or take a screenshot. Changing any option turns numbering on; the style is remembered for the next document, and every change can be undone.
  - **Tool options panel**: Redact, Add Text, Comment, Select, Screenshot, and Page numbers show their options in a panel on the right while they're on. Its × (or the tab on its edge) hides it without turning the tool off, and the choice is remembered. The bottom toolbar stays where it is when the panel opens.
- Dark mode (follows the OS by default) and fullscreen.

### Placing the signature

- Turn on the **Signature** tool, then drag a signature from the panel onto the page, or click the large preview to place the active one. Click-to-place mode follows the cursor.
- Move and resize (aspect ratio locked); several signatures per document are supported. Selected items can be nudged with the arrow keys and removed with `Delete`.
- **Use last position** re-applies the last placement (as a ratio of the page) to the current page.
- **Apply Signature to All N Pages** copies the current page's signature(s) to the same spot on every page.
- **Apply to All N Documents** places the signature on page 1 of every open single-page PDF.

### Visible watermark

- Multi-line custom text, plus an optional date & time stamp.
- **Save watermark texts** with the bookmark button and reuse them with one click from the chips under the text box (hover a chip to remove it). Up to 20 are kept, most recent first.
- 9-position picker, color, size, and opacity. Scroll the mouse wheel over the size and opacity sliders to adjust them.
- Live preview on the signature in both the sidebar and the page.
- Flattened into the signature image at export. Preferences persist across sessions.

### Export

- **Save** and **Print** sit at the right end of the top bar. The arrow next to Save opens **Save compressed**, **Save each page as a separate PDF (ZIP)**, **Save all (ZIP)**, **Save all as one PDF** (choose the order), and the export options below.
- Exported as `original_filename_signed.pdf`.
- **Save compressed** saves everything you added, then shrinks the file in the browser: images are scaled down (at most 1800 px on the long side) and re-encoded as JPEG, uncompressed streams are deflated, and objects are packed into object streams. Text, vector graphics, and fonts are untouched, an image is only replaced when the result is clearly smaller, and the file is never made bigger. It works on an unedited PDF too, and reports the size before and after. Saved as `original_filename_compressed.pdf`.
- Optional: strip embedded JavaScript carried over from the source PDF, lock text/content copying (printing, form filling, and annotating stay allowed), and **require a password to open** the saved PDF (AES-256). The password is kept in memory for the visit only, never stored; the Save button shows a lock while it's on. Printing skips the password, since the print dialog can't ask for it.
- **Remove a password**: a password-protected PDF shows a password field in place of its pages (and in the list of added files, and in Verify). Once unlocked, it works like any other PDF and what you save opens without the password. PDFs that only restrict permissions (copying, printing) open and save without any prompt, and the saved copy is unrestricted.
- Each export embeds a small RayPDF record (document ID, name, export time, watermark text) in the PDF's metadata.

### Verify

- Add one or more PDFs and choose **Verify** to read each one's RayPDF record back, showing whether and when it was exported by RayPDF. You can switch to signing the same files from there. This confirms provenance, not that the pages are unchanged since. That's what the planned invisible watermark is for.

### Offline (PWA)

- A service worker precaches the app, including the pdf.js worker. New versions wait in the background until the user clicks **Reload to update**, so work in progress is never interrupted.

## Roadmap

- **Invisible watermark**: DWT/DCT-based payload (signer, document ID, timestamp, signature ID), implemented as a replaceable module independent of the visible watermark.
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

`vite.config.ts` sets `base: '/raypdf/'` in production builds. Update `REPO_NAME` there if the repository is renamed.

Project guidelines (product vision, principles, UX rules, code structure, and workflow) live in [CLAUDE.md](CLAUDE.md). In short: run `npm run check` before committing, then push and `npm run deploy` after each change, and keep this README's feature list up to date.

### Layout

- `src/components/`: UI (`PDFViewer`, `PageSidebar`, `FloatingControls`, `SignaturePanel`, `ExportButton`, `DocumentTabs`, `VerifyResults`, …)
- `src/stores/`: app state (`editor.ts` holds documents, placements, and undo history; one small store per tool)
- `src/lib/pdf/`: loading, rendering, export, compression, redaction, page operations, form filling, screenshots, verification
- `src/lib/watermark/`: visible watermark layout and rendering
- `src/lib/signature/`: signature storage and sizing
- `src/lib/utils/`: persistence, file validation, tooltip and other Svelte actions
