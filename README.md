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

- The front page shows the upload area at the top, then a tour of every feature, one illustrated row each, animated while hovered: signing with the protected signature first (with an illustration of a copied signature giving itself away), then "Everything in one go" (several jobs on one document, saved once), then each tool, and a short "Also in RayPDF" list for the rest. The FAQs sit at the bottom.
- Upload one or more PDFs (drag & drop anywhere on the page, or click to browse). Files are type- and size-checked (50 MB per PDF, 10 MB per signature image).- Then choose what to do with them: **Open in editor** opens the editor (signing, form filling, markup, and redaction), **Verify** checks each PDF for a RayPDF record right on the front page.
- **Add a signature three ways:** draw it with a mouse, finger, or pen (pressure-sensitive, black or blue ink); type your name in one of four handwriting fonts (bundled, so this works offline); or upload a scan.
- **Keep several signatures**, say a full signature and your initials. All are saved in IndexedDB, so returning users only need to upload a new PDF. Click one to make it the one new placements use, or drag any of them straight onto the page; each placed signature remembers which one it is. Delete any of them at any time.

### Editor

- **Document tabs** for every open PDF, with a close-confirmation for unsaved work and a tab context menu. Drag tabs to reorder them (or use Ctrl+Shift+←/→, or Move left/right in the tab menu). Add more PDFs any time.
- **Continuous scrolling**: all pages sit in one column, so you can scroll from page to page. The page you're looking at (or last worked on) is the current page for the toolbar, the page picker, and the sidebar, and jumping to a page scrolls to it. Only pages near the view are drawn, so long documents stay quick.
- **Page sidebar** (toggle with `Ctrl+B`): thumbnails of every page, rendered as they scroll into view so long documents open quickly. Redaction boxes show on the thumbnails as you draw them. Click to jump; **drag and drop to reorder pages**.
- **Select several pages** with Ctrl/⌘-click, Shift-click for a range, the checkbox on each thumbnail, or Ctrl+A. A bar at the top of the sidebar then rotates, saves (as one PDF with just those pages), or deletes them all at once; `Delete` and `Esc` work too.
- **Right-click a thumbnail** for the page tools: on the whole selection if the page is part of it, otherwise on just that page (rotate left/right, move up/down, duplicate, insert a blank page after, recognize text, save as PDF, PNG, or JPG, select, delete). Page edits change the PDF itself; signatures, redactions, text, highlights, comments, shapes, and images follow their page, and every edit can be undone. Images include everything added to the page except comments; several pages download as a ZIP.
- **Resize the sidebar** by dragging its right edge (or focusing it and using the arrow keys); double-click the edge to reset. The width is remembered, and thumbnails render sharper as it grows.
- **Right-click the document** for a menu that fits what's under the pointer: on the page, place the signature, add text or a comment right there, zoom, rotate the page, copy it as an image, or recognize its text (on the whole page or in an area); on selected text, copy, highlight, underline, strike it through, or comment on it; on a markup, add or edit its comment, remove it, or change a highlight's color; on a placed signature, redaction, text box, comment, shape, or image, edit or delete it. The page menu also has Add image here.
- **Find in the document** with Ctrl+F (⌘F) or the search button: matches on every page are counted, highlighted on the page, and stepped through with Enter / Shift+Enter. Matching ignores case and treats line breaks as spaces. When nothing is found, a **Recognize text** button is offered, since a scan has no text to search yet.
- **Recognize text (OCR)** in scanned pages, in English, Indonesian, Malay, Dutch, French, German, Italian, Portuguese, or Spanish (pick one under **Language** in the toolbar menu; it's remembered): the **Recognize text** button in the floating toolbar opens a menu to recognize the current page or every page without text, and the page or thumbnail right-click menu does just those pages. **Recognize text in an area** (in the same toolbar menu, or the page menu) lets you drag a rectangle around any text, even a picture of text on a page that already has some: the words are added the same way, except those that are already text, and a **Copy text** button copies what was read. The words are written onto the page as invisible text right where they appear, so the page looks the same but can be searched, selected, and copied, here and in other PDF readers once saved. Pages that already have text are skipped, a status bar shows the progress (with Cancel), and it can be undone. It runs in the browser with tesseract.js; its engine (about 1.5 MB) is only downloaded the first time it's used, and each language's data (1 to 3 MB) the first time that language is used; both are then cached for offline use.
- **Fill in PDF forms**: a PDF's own text fields, checkboxes, radio buttons, and dropdowns can be filled in directly on the page. The values are written into the real fields on export, so the result is still a normal fillable form.
- **Floating toolbar** (icon-only, with instant tooltips):
  - Undo / Redo (`Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`)
  - Previous / next page and a page picker (`←` / `→`; `Ctrl+←` / `Ctrl+→` switches documents)
  - Zoom out / in; the zoom percentage opens a menu of common levels (50% to 250%), fit page width, and fit whole page. Ctrl+scroll (or a touchpad pinch) zooms around the pointer, and Ctrl+= / Ctrl+− / Ctrl+0 zoom in, out, and back to 100%, instead of zooming the browser
  - Rotate left / right
  - Tools, grouped by task: Move and Select; signing and filling in; markup; protection; page tools (`Esc` returns to Move):
    - **Move**: drag placed items around; drag the page background to pan. Resting the pointer on text switches to text selection, which stays on while the pointer moves over text and turns back into the hand once it leaves.
    - **Select**: select and copy the PDF's real text. After selecting, a small toolbar appears below the selection to **highlight, underline, or strike through** the text permanently. Highlights come in five colors; underlines and strikethroughs are always black. Each is exported as a real PDF markup annotation (Highlight, Underline, StrikeOut). The toolbar's **Comment** button highlights the text and opens a note attached to it; the note is saved as the highlight's own comment, which other readers show when it's hovered or opened. Click a markup to remove it (also `Delete`), add or edit its comment, or recolor a highlight. Removing a markup removes its comment; deleting the comment keeps the markup. Its options pick the color for the next highlight.
    - **Signature**: opens the signature panel on the right (your signatures, placement helpers, watermark). The page still behaves like Move, so placed signatures can be dragged and resized. Turning the tool off, or `Esc`, closes the panel.
    - **Add Text**: click to place a text box. Its options restyle the selected box, or set the style for new ones when none is selected: font, size, bold, italic, underline, strikethrough, superscript and subscript (for the whole box), alignment, color, a background color (handy for covering text), letter spacing, word spacing, line spacing, and opacity, with a live sample. The saved PDF and screenshots match the editor.
    - **Add image**: place a picture, logo, or stamp (PNG, JPEG, WebP, GIF, SVG, …) on the page in view, or drop an image file straight onto a page, or right-click the page and choose Add image here. Images keep their proportions when resized and are embedded in the saved PDF upright, as placed.
    - **Comment**: click to leave a sticky note, exported as a real PDF annotation. Its options list every comment in the document; click one to jump to its page, or delete it.
    - **Shapes**: drag on the page to draw a rectangle, ellipse, line, or arrow (hold Shift for a square, a circle, or a line at 45° steps; a plain click drops one of a default size). Its options pick the shape, outline color and width, fill, and opacity, and restyle the selected shape. Shapes can be moved, resized, nudged with the arrow keys, and deleted, and are drawn into the saved PDF as vector graphics.
    - **Redact**: draw boxes; the content underneath is permanently removed from the exported PDF. Its options list every box by page: click to jump, remove one box, a whole page's, or all of them, or copy a box to the same spot on every other page. When several PDFs are open, **Apply to All Documents** makes every other open document's redactions match this one.
    - **Watermark**: stamp a word (such as CONFIDENTIAL or DRAFT) or a picture (such as a logo) across every page, once in the middle or tiled over the whole page. Text has a font, bold, size, and color; a picture has a width; both have an angle (with -45°, 0°, 45°, and 90° presets) and an opacity. It shows on the pages right away, sits over the page's content and under anything you've placed, stays the same on rotated pages, and is drawn into the saved or printed PDF and screenshots. The style is remembered for the next document, and every change can be undone. This is separate from the signature's own protective watermark.
    - **Page numbers**: number the document's pages. Pick the position (top or bottom, left, center, or right), the format (1, Page 1, Page 1 of 9, 1 / 9, - 1 -), the starting number, the first page to number (to skip a cover), the font, size, distance from the edge, and color. The numbers show on the pages right away, stay upright on rotated pages, and are added when you save, print, or take a screenshot. Changing any option turns numbering on; the style is remembered for the next document, and every change can be undone.
    - **Header & footer**: the same tool's second tab. Type text into any of six spots (left, center, or right of the top and bottom edges), with fields for the page number, page count, date, and file name (`{page}`, `{pages}`, `{date}`, `{file}`), a first page to start on, and the font, size, distance from the edge, and color. Shown on the pages as you type and added when you save, print, or take a screenshot; a note warns if the page numbers sit in the same spot. The standard PDF fonts cover Latin text only, so other characters save as "?".
    - **Crop**: drag on a page to frame the part to keep; drag the frame to move it or its edges and corners to resize it. **Frame the content** sets the frame around what's on the page, leaving out blank margins. Crop that page (or press `Enter`), or all pages the same way (pages of other sizes in proportion). Cropping sets the page's crop box, so what's cut off is hidden rather than deleted and **Show the whole page again** brings it back; everything placed on the page stays over the same content, and every crop can be undone.
    - **Screenshot**: click a page to capture all of it, or drag a rectangle to capture an area. By default the image is copied to the clipboard, with a **Save PNG** option. Captures include placed signatures (with their watermark), text, highlights, shapes, images, redactions, and form values, but not comments, which are notes rather than page content. Its options choose copy or download, the resolution (1× to 4×), and whether to include what you've added.
    - **Recognize text**: a menu to recognize the text on this page, on every page, or in an area you drag, and the language to read (see Recognize text (OCR) above).
  - **Tool options panel**: Redact, Add Text, Comment, Select, Screenshot, Page numbers (with the header and footer), Watermark, Shapes, and Crop show their options in a panel on the right while they're on. Its × (or the tab on its edge) hides it without turning the tool off, and the choice is remembered (for Signature, Page numbers, Watermark, and Crop, it turns the tool off). The bottom toolbar stays where it is when the panel opens.
- Dark mode (follows the OS by default) and fullscreen.

### Placing the signature

- Turn on the **Signature** tool, then drag a signature from the panel onto the page, or click the large preview to place the active one. Click-to-place mode follows the cursor.
- Move, resize (aspect ratio locked), and rotate to any angle: drag the round handle above a selected signature (it snaps upright and to quarter turns, Shift snaps to 15° steps), use the arrow keys on that handle (15° steps, 1° with Shift), double-click it to straighten, or right-click for Rotate left / Rotate right / Straighten. The saved PDF and screenshots show it turned exactly as placed. Several signatures per document are supported. Selected items can be nudged with the arrow keys and removed with `Delete`.
- **Use last position** re-applies the last placement (as a ratio of the page) to the current page.
- **Apply Signature to All N Pages** copies the current page's signature(s) to the same spot on every page.
- **Apply to All N Documents** places the signature on page 1 of every open single-page PDF.

### Visible watermark (on the signature)

- Multi-line custom text, plus an optional date & time stamp.
- **Save watermark texts** with the bookmark button and reuse them with one click from the chips under the text box (hover a chip to remove it). Up to 20 are kept, most recent first.
- 9-position picker, color, size, and opacity. Scroll the mouse wheel over the size and opacity sliders to adjust them.
- Live preview on the signature in both the sidebar and the page.
- Flattened into the signature image at export. Preferences persist across sessions.

### Export

- **Save** and **Print** (Ctrl+P prints the edited PDF, not the editor) sit at the right end of the top bar. The arrow next to Save opens **Save compressed**, **Save each page as a separate PDF (ZIP)**, **Save all (ZIP)**, **Save all as one PDF** (choose the order), and the export options below.
- Exported as `original_filename_signed.pdf`.
- **Save compressed** saves everything you added, then shrinks the file in the browser: images are scaled down (at most 1800 px on the long side) and re-encoded as JPEG, uncompressed streams are deflated, and objects are packed into object streams. Text, vector graphics, and fonts are untouched, an image is only replaced when the result is clearly smaller, and the file is never made bigger. It works on an unedited PDF too, and reports the size before and after. Saved as `original_filename_compressed.pdf`.
- Optional: strip embedded JavaScript carried over from the source PDF, lock text/content copying (printing, form filling, and annotating stay allowed), and **require a password to open** the saved PDF (AES-256). The password is kept in memory for the visit only, never stored; the Save button shows a lock while it's on. Printing skips the password, since the print dialog can't ask for it.
- **Remove a password**: a password-protected PDF shows a password field in place of its pages (and in the list of added files, and in Verify). Once unlocked, it works like any other PDF and what you save opens without the password. PDFs that only restrict permissions (copying, printing) open and save without any prompt, and the saved copy is unrestricted.
- Each export embeds a small RayPDF record (document ID, name, export time, watermark text) in the PDF's metadata.

### Verify

- Add one or more PDFs and choose **Verify** to read each one's RayPDF record back, showing whether and when it was exported by RayPDF. You can switch to signing the same files from there. This confirms provenance, not that the pages are unchanged since. That's what the planned invisible watermark is for.

### Offline (PWA)

- A service worker precaches the app, including the pdf.js worker. The text recognition files are left out of the precache, so nobody downloads them without using them; they're cached the first time text is recognized. New versions wait in the background until the user clicks **Reload to update**, so work in progress is never interrupted.

## Roadmap

- **Invisible watermark**: DWT/DCT-based payload (signer, document ID, timestamp, signature ID), implemented as a replaceable module independent of the visible watermark.
- Rotating a placed signature, and snapping it to page edges.
- Signature background removal.
- Automated tests (coordinate mapping in `lib/pdf/export.ts`, zoom rescaling in `stores/editor.ts`).

## Development

Stack: Svelte 5 + Vite + TypeScript (strict), Tailwind CSS, pdf.js, pdf-lib (`@cantoo/pdf-lib`), IndexedDB (via `idb`), JSZip, tesseract.js (text recognition, loaded on first use; `vite.config.ts` serves its worker, engine, and the language data listed in `lib/pdf/ocrLanguages.ts` from `ocr/`).

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
- `src/lib/pdf/`: loading, rendering, export, compression, redaction, page operations, form filling, screenshots, text recognition, verification
- `src/lib/watermark/`: visible watermark layout and rendering
- `src/lib/signature/`: signature storage and sizing
- `src/lib/utils/`: persistence, file validation, tooltip and other Svelte actions
