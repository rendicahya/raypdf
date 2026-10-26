# RayPDF

(Formerly Signy. Storage keys still use the old name on purpose: the IndexedDB database `signy`, the `signy:` localStorage prefix. Renaming them would wipe returning users' signatures and settings. The verifier also accepts the old `signy-verify:v1:` marker.)

## Product Vision

RayPDF is a privacy-first, in-browser PDF editor: signing, form filling, markup, redaction, page edits, and verification.

Its headline feature, and what sets it apart from other PDF tools, is protecting scanned handwritten signatures by binding them to the document context using watermarking techniques.

RayPDF is **not** a replacement for PKI-based digital signatures. It is a lightweight protection layer for organizations that still rely on handwritten signature images.

The application should feel modern, approachable, and extremely easy to use.

The entire signing process should take less than one minute.

---

# Core Principles

- Privacy first.
- Everything runs locally in the browser.
- No backend.
- No database.
- No authentication.
- No cloud storage.
- Never upload user files.
- GitHub Pages compatible.

---

# Tech Stack

Framework

- Svelte 5 (runes)
- Vite
- TypeScript (strict)

Styling

- Tailwind CSS (`darkMode: 'class'`)

PDF

- pdf.js (`pdfjs-dist`) — rendering, text layer, text extraction
- pdf-lib (`@cantoo/pdf-lib` fork) — export, redaction, page operations, form filling, metadata

Other

- `idb` — IndexedDB for the saved signature
- JSZip — multi-file downloads
- tesseract.js — text recognition in scans, loaded on first use
- `vite-plugin-pwa` — offline support (prompt-to-update, never auto-reload)

Image Processing

- HTML Canvas API

Future

- OpenCV.js
- DWT / DCT watermarking

Deployment

- GitHub Pages (`npm run deploy` → `gh-pages` branch)

---

# User Experience

The application should require as few clicks as possible.

Avoid dialogs and unnecessary configuration.

Users should immediately understand what to do.

The interface should feel similar to modern tools like Canva or Figma: drag, drop, resize.

Toolbar buttons are icon-only, with instant tooltips (`lib/utils/tooltip.ts`) instead of native `title` delays.

---

# User Flow

## First Visit

Display a large Add PDF upload card (one or more files), the feature showcase (`FeatureGrid`) below it, and the FAQs (`Faq`) last; Sign with the watermarked signature (WatermarkIllustration) leads, and every user-facing feature appears either in a row or in the "Also in RayPDF" list below them. After PDFs are added, the user picks **Open in editor** or **Verify**. Signatures are added inside the editor's Signature panel.

The upload card supports:

- Drag & Drop
- Click to Browse

After the signature is uploaded:

Store it locally using IndexedDB.

---

## Returning Users

Automatically load the saved signature.

Display:

- Signature preview
- Replace Signature
- Delete Signature

Users should only need to upload a new PDF.

---

## PDF Editor

Display the PDF using pdf.js, with one tab per open document. Pages scroll continuously: PDFPages loads the file and stacks a placeholder of each page's real size, mounting a PDFViewer (one page: canvas, text layer, overlays, its own `pageNumber` prop) only for pages near the view. The page in view becomes `pageNumber` in the store, pointerdown on a page makes it current without scrolling, and any other change to `pageNumber` scrolls to that page. Anything shared across pages (like `selectedTextId`) must not be cleared by a page that doesn't hold it.

Left sidebar: page thumbnails, rendered lazily as they scroll into view, with redaction boxes overlaid (not re-rendered). The thumbnail menu's "Save page as" submenu (ContextMenu `children`) saves PDF, PNG, or JPG; images are rendered from the exported PDF (`lib/pdf/pageImages.ts`), so they match the saved file. Click to jump, drag and drop to reorder pages; the thumbnail's right-click menu rotates, moves up or down, duplicates, inserts a blank page after, or deletes (there's no per-thumbnail toolbar). Several pages can be selected (Ctrl/Shift-click, checkboxes) to rotate, save, or delete together. Page edits rewrite the file (`lib/pdf/pageOps.ts`) and go through `editPages` in `stores/editor.ts`, which renumbers everything placed on the pages and keeps the old file for undo.

The PDF's own form fields are drawn as HTML inputs over the page (`lib/pdf/forms.ts`); values are stored per document by field name and written into the real fields on export.

Right sidebar (ToolPanel): the active tool's options (`stores/toolPanel.ts`). For the Signature tool (`stores/signatureTool.ts`) it's SignaturePanel: the saved signatures, placement helpers (Use last position, Apply Signature to All Pages, Apply to All Documents), and watermark controls; on the canvas the Signature tool behaves like Move, click-to-place is its sub-mode and turns off with it, and closing the panel turns the tool off. The Page numbers tool (`stores/pageNumbersTool.ts`, PageTextOptions with a Page numbers tab, PageNumberOptions, and a Header & footer tab, HeaderFooterOptions) works the same way: its settings live on the document (`pageNumbers`, `headerFooter`, undoable; `headerFooter` is null when every slot is empty). `pageLabels` in `lib/pdf/headerFooter.ts` turns both into the `PageLabel`s of a page (placeholders `{page}` `{pages}` `{date}` `{file}` filled in), which PDFViewer previews, `screenshot.ts` draws, and `drawPageLabels` in `lib/pdf/pageNumbers.ts` draws on export (positioned on the page as shown, so rotated pages stay upright). Shapes (`stores/shapeTool.ts`, ShapeOptions) draws `PlacedShape`s by dragging on the page; images (`PlacedImage`, the picture itself kept in memory in `stores/images.ts`, by `imageId`) come from the toolbar's Add image (via `pendingImage`, placed by the page in view), a dropped image file, or the page menu. Both are moved and resized by PlacedBox, drawn by ShapeGraphic / `<img>` on screen, `lib/pdf/shapes.ts` on export (shared geometry, images upright on rotated pages), and `screenshot.ts`; a new item list on the document goes in `PageItems` / `mapPageItems` in `stores/editor.ts` so rotation and page edits carry it. Crop (`stores/cropTool.ts`, CropOptions, CropOverlay) frames the area to keep as fractions of the page as shown; `cropPages` / `uncropPages` in the editor store set the pages' crop box through `editPages` (`reshapesPages`, so placed items stay over the same content). Anything drawn over a whole page on export must use the visible area (pdf.js `page.view`), not the media box, as `redact.ts` does. Like Signature and Page numbers, Crop's panel can't be hidden: its × turns the tool off. Redact, Add Text, Comment, Select, Screenshot, and Shapes have their own panels in `components/toolOptions/` (text boxes have no floating style bar: TextOptions restyles the box in `selectedTextId`, and clicks inside `[data-tool-panel]` don't deselect it; a new `PlacedText` style field must be drawn the same way in PDFViewer, `screenshot.ts`, and `textRender.ts`, and superscript/subscript share `SCRIPT_SCALE` / `SCRIPT_SHIFT` from `stores/textTool.ts`); their × only hides the panel (`toolPanelOpen`, persisted) and an edge tab brings it back. A new tool with options needs a case in `activePanelTool` and in ToolPanel.

The bottom toolbar is positioned by App.svelte, centred on the area right of the page sidebar including the panel, so it doesn't move when the panel opens (it only slides left if it would otherwise overlap the panel).

Save / Print (ExportButton) sit at the right end of the top Toolbar; the chevron menu holds the other save options and the export toggles.

The user drags the signature from the panel onto the document.

Supported interactions:

- Move
- Resize

Floating toolbar (bottom): undo/redo, page navigation, zoom, fit, rotate, and the tools — Move, Signature, Redact, Add Text, Comment, Zoom (right-click zooms out), Select, Screenshot, Page numbers (with header & footer), Shapes, Crop, and the Add image button.

Selecting text shows a markup toolbar (highlight in five colors, underline / strikethrough always black via `markupColorFor`); markups are stored per document as `PlacedHighlight` (one box per line, grouped by `groupId`, with `kind` and `color`) and exported as PDF Highlight / Underline / StrikeOut annotations (`lib/pdf/highlight.ts`).

Ctrl+F opens SearchBar (`stores/search.ts`, `lib/pdf/search.ts`): matches are counted from pdf.js text content and boxed on screen from the text layer.

Recognize text (OCR, English only for now; `stores/ocr.ts`, progress in OcrStatus) is an action, not a tool: the top bar button's menu (every page, or an area), the page and thumbnail menus, and SearchBar's "No results". "In an area" waits for a drag on a page (`ocrAreaMode`, the `selecting` status, a PDFViewer overlay like Screenshot's); it behaves like a tool (turning on any other tool, Move, or Escape ends it), recognizes even on pages with text, skips words that are already text (`recognizeArea` in `lib/pdf/ocr.ts`), and offers the text for copying in OcrStatus. `lib/pdf/ocr.ts` renders pages without text as shown and runs tesseract.js (imported dynamically, so it's not in the main bundle); `addInvisibleText` in `pageOps.ts` writes the words into the file as invisible text (render mode 3) through `editPages`, so the text layer, Find, copying, and export need nothing extra. Its worker, engine, and language data are served from `ocr/` by the `ocrFiles` plugin in `vite.config.ts`, kept out of the PWA precache and cached on first use; never load them from a CDN.

Several signatures can be saved (drawn, typed, or uploaded — `SignatureCreator`, `lib/signature/create.ts`); every `PlacedSignature` has a `signatureId`, and export takes a `signatureFor` lookup rather than one image.

Tools are mutually exclusive: turning one on turns the others off, and Escape or Move returns to the default. A new tool must be added to every place that resets the others (FloatingControls, App's Escape handler, PDFViewer's hover/pan checks). The Signature tool is the exception in PDFViewer: it leaves the canvas in Move behavior, so it isn't in those checks.

Future:

- Rotate the placed signature
- Snap to page edges

---

## Export

When Export PDF is pressed:

1. Generate a protected signature.
2. Apply visible watermark.
3. (Future) Embed invisible watermark.
4. Insert the signature into the PDF.
5. Download:

original_filename_signed.pdf

Also available: save compressed (`lib/pdf/compress.ts`: re-encodes images as smaller JPEGs, deflates raw streams; runs on the exported bytes, with copy-locking applied after it), save the current page only, each page as a separate PDF (ZIP), all documents (ZIP), merge documents in a chosen order, and print. Optional: strip embedded JavaScript, lock copying, require a password to open (`lib/pdf/password.ts`: `applyProtection`, the last step before saving; the password lives in `stores/exportOptions.ts`, memory only). Load PDFs for editing with `loadEditablePdf` (it decrypts permission-only encryption); a PDF that needs a password to open is unlocked by UnlockPdf (shown by PDFPages, the front-page file list, and VerifyResults), which swaps in a decrypted copy via `editorStore.unlockDocument`.

Every export embeds a small verification record in the PDF metadata (`lib/pdf/verification.ts`).

---

# Visible Watermark

Visible watermark is part of the signature image.

Never draw the watermark directly onto the PDF.

The protected signature should become a single image.

Goals:

- Harder to reuse after screenshot.
- Harder to crop cleanly.
- Still professional.
- Minimal visual distraction.

Watermark examples:

- Signer name
- Document name
- Document ID
- Date
- Timestamp
- Unique identifier

Opacity should be configurable.

---

# Invisible Watermark

Future module.

The implementation should be completely independent from the visible watermark.

Possible payload:

- signer
- document ID
- timestamp
- signature ID

Preferred algorithms:

- DWT
- DCT

The module should be replaceable.

---

# Local Storage

Save the latest signature in IndexedDB.

Do not use localStorage for image data. Small preferences (watermark settings, export options, theme) use localStorage via `lib/utils/persist.ts`.

Users should never need to upload their signature every time they use RayPDF.

---

# Code Structure

components/

- UploadCard, FeatureGrid (front-page feature showcase, one row per feature, drawings in FeatureIllustration; they play once while their row is hovered, using the `fi-*` classes in `app.css`, and must end on their resting frame), Faq, WatermarkIllustration, SignatureCreator, SearchBar
- PDFPages (the scrolling page column), PDFViewer (one page), PageSidebar, PageThumbnail
- DocumentTabs, DocumentThumbnail, Toolbar
- FloatingControls (the bottom toolbar)
- ToolPanel, SignaturePanel, toolOptions/ (PanelHeader, RedactOptions, TextOptions, CommentOptions, SelectOptions, ScreenshotOptions, PageTextOptions, PageNumberOptions, HeaderFooterOptions, ShapeOptions, CropOptions)
- ExportButton, MergeOrderDialog, StartOverButton
- VerifyResults (the Verify choice on the front page; checks every added PDF in place)
- ThemeToggle, FullscreenToggle, UpdateToast
- PlacedBox (a movable, resizable item on a page: shapes, images), ShapeGraphic, CropOverlay, UnlockPdf, OcrStatus
- ContextMenu (reusable right-click menu; used by PageSidebar and PDFViewer, icons in `lib/utils/menuIcons.ts`)

lib/

- pdf/ — loader, docCache, export, compress, pageImages, pageNumbers, headerFooter, contentBounds, password, shapes, forms, highlight, search, ocr, pageOps, redact, sanitize, placement, screenshot, textLayer, textRender, verification
- watermark/ — visible watermark
- signature/ — IndexedDB storage (several signatures), sizing, drawn/typed creation
- utils/ — persist, fileValidation, portal, tooltip, wheelRange

stores/

- editor.ts — documents, placements, page order, per-document undo/redo history
- one small store per tool or preference (redact, textTool, commentTool, zoomTool, textSelect, screenshotTool, shapeTool, cropTool, images, ocr, clickToPlace, watermark, exportOptions, layout, theme, …)

---

# Development Roadmap

## MVP — done

- Upload PDF
- Upload Signature
- Save Signature
- Drag Signature
- Resize Signature
- Export PDF

## Version 0.2 — done

- Visible watermark customization

## Version 0.3

- Invisible watermark

## Version 0.4 — basic version done

- Verification page (reads the metadata record; the invisible watermark will make it tamper-evident)

---

# Workflow

- Run `npm run check` before committing. Two errors in `lib/pdf/loader.ts` and `lib/pdf/redact.ts` (`'canvas' does not exist in type 'RenderParameters'`) are known and pre-existing.
- After each change: commit, `git push`, then `npm run deploy`.
- Keep README.md's feature list in sync when adding or changing user-facing features.

---

# Coding Guidelines

- TypeScript strict mode.
- Prefer reusable components.
- Separate UI from business logic.
- Keep components small.
- Avoid unnecessary dependencies.
- Write readable and maintainable code.
- Optimize for GitHub Pages deployment.

---

# UI Guidelines

Prefer a clean and minimal interface.

Large upload targets.

Smooth animations.

Minimal toolbar.

Generous whitespace.

Responsive layout.

Dark mode support.

---

# Out of Scope

Do not implement:

- User accounts
- Authentication
- Cloud synchronization
- Online storage
- Server-side processing

Everything must work entirely offline after the application is loaded.
