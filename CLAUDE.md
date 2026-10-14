# Signy

## Product Vision

Signy is a privacy-first web application for signing PDF documents using handwritten signature images.

Unlike traditional PDF signing tools, Signy focuses on protecting scanned handwritten signatures by binding them to the document context using watermarking techniques.

Signy is **not** a replacement for PKI-based digital signatures. It is a lightweight protection layer for organizations that still rely on handwritten signature images.

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
- pdf-lib (`@cantoo/pdf-lib` fork) — export, redaction, page reordering, metadata

Other

- `idb` — IndexedDB for the saved signature
- JSZip — multi-file downloads
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

Display two large upload cards.

- Upload PDF (one or more)
- Upload Signature

Both support:

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

Display the PDF using pdf.js, with one tab per open document.

Left sidebar: page thumbnails. Click to jump, drag and drop to reorder pages.

Right sidebar: the saved signature, placement helpers (Find Signature Spot, Use last position, Apply Signature to All Pages, Apply to All Documents), watermark controls, and export.

The user drags the signature from the panel onto the document.

Supported interactions:

- Move
- Resize

Floating toolbar (bottom): undo/redo, page navigation, zoom, fit, rotate, and the tools — Move, Redact, Add Text, Comment, Zoom (right-click zooms out), Select, Screenshot.

Tools are mutually exclusive: turning one on turns the others off, and Escape or Move returns to the default. A new tool must be added to every place that resets the others (FloatingControls, SignaturePanel's click-to-place, App's Escape handler, PDFViewer's hover/pan checks).

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

Also available: save the current page only, each page as a separate PDF (ZIP), all documents (ZIP), merge documents in a chosen order, and print. Optional: strip embedded JavaScript, lock copying.

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

Users should never need to upload their signature every time they use Signy.

---

# Code Structure

components/

- UploadCard, SignatureUploader
- PDFViewer, PageSidebar, PageThumbnail
- DocumentTabs, DocumentThumbnail, Toolbar
- FloatingControls (the bottom toolbar)
- SignaturePanel
- ExportButton, MergeOrderDialog, StartOverButton
- VerifyPage
- ThemeToggle, FullscreenToggle, UpdateToast

lib/

- pdf/ — loader, docCache, export, redact, sanitize, placement, reorder, screenshot, signatureDetect, textLayer, textRender, verification
- watermark/ — visible watermark
- signature/ — IndexedDB storage, sizing
- utils/ — persist, fileValidation, portal, tooltip, wheelRange

stores/

- editor.ts — documents, placements, page order, per-document undo/redo history
- one small store per tool or preference (redact, textTool, commentTool, zoomTool, textSelect, screenshotTool, clickToPlace, watermark, exportOptions, layout, theme, …)

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
