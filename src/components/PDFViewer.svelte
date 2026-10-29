<script lang="ts" module>
  // The find-bar match last scrolled to, shared by every page.
  let lastScrolledMatch = '';
</script>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { renderPageToCanvas, type PdfDocument } from '../lib/pdf/loader';
  import { renderTextLayer, cancelTextLayer, textItemIndices } from '../lib/pdf/textLayer';
  import { selectionFonts, fontLabels } from '../lib/pdf/fontInfo';
  import { PAGE_DRAG_TYPE } from '../lib/pdf/pageOps';
  import { capturePage, copyImageToClipboard, downloadBlob, type CaptureOverlays } from '../lib/pdf/screenshot';
  import { headerFooterDate, pageLabels } from '../lib/pdf/headerFooter';
  import { watermarkCenters, watermarkSize } from '../lib/pdf/pageWatermark';
  import { getPageFormWidgets, widgetValue, type FormWidget } from '../lib/pdf/forms';
  import { getTotalRotation } from '../lib/pdf/loader';
  import type { PDFPageProxy } from 'pdfjs-dist';
  import { downloadImage, imageAt, imagePng, pageImages, type PaintedImage } from '../lib/pdf/embeddedImages';
  import {
    MARKUP_COLORS,
    MARKUP_LABELS,
    markupColorFor,
    markupPaint,
    selectionToBoxes,
    type Box,
  } from '../lib/pdf/highlight';
  import { markupColor } from '../stores/markup';
  import { search } from '../stores/search';
  import { findInTextLayer } from '../lib/pdf/search';
  import { MENU_ICONS } from '../lib/utils/menuIcons';
  import {
    ocrStatus,
    ocrAreaMode,
    recognizeText,
    recognizeTextInArea,
    startAreaSelection,
    isOcrRunning,
  } from '../stores/ocr';
  import { tooltip } from '../lib/utils/tooltip';
  import ContextMenu, { type ContextMenuItem } from './ContextMenu.svelte';
  import PlacedBox from './PlacedBox.svelte';
  import ShapeGraphic from './ShapeGraphic.svelte';
  import {
    shapeToolMode,
    selectedShapeId,
    shapeKind,
    shapeStroke,
    shapeStrokeWidth,
    shapeFill,
    shapeOpacity,
  } from '../stores/shapeTool';
  import { cropToolMode } from '../stores/cropTool';
  import CropOverlay from './CropOverlay.svelte';
  import { addImageFile, imageFor, isImageFile, pendingImage, IMAGE_ACCEPT } from '../stores/images';
  import { applyVisibleWatermark } from '../lib/watermark/visible';
  import {
    screenshotToolMode,
    screenshotResult,
    screenshotScale,
    screenshotIncludeEdits,
    screenshotDestination,
  } from '../stores/screenshotTool';
  import {
    editorStore,
    activeDocument,
    type MarkupKind,
    type PlacedSignature,
    type PlacedText,
    type RedactionBox,
    type PlacedComment,
    type ShapeKind,
  } from '../stores/editor';
  import { redactMode } from '../stores/redact';
  import { commentToolMode } from '../stores/commentTool';
  import { clickToPlaceMode } from '../stores/clickToPlace';
  import { textSelectMode } from '../stores/textSelect';
  import {
    textToolMode,
    selectedTextId,
    defaultTextFontFamily,
    defaultTextFontSize,
    defaultTextBold,
    defaultTextItalic,
    defaultTextUnderline,
    defaultTextColor,
    defaultTextLetterSpacing,
    defaultTextAlign,
    defaultTextStrikethrough,
    defaultTextBackground,
    defaultTextOpacity,
    defaultTextWordSpacing,
    defaultTextLineHeight,
    defaultTextScript,
    FONT_FAMILY_CSS,
    SCRIPT_SCALE,
    SCRIPT_SHIFT,
    textDecoration,
  } from '../stores/textTool';
  import { signatureStore, resolveSignature } from '../stores/signature';
  import { openSignatureTool } from '../stores/signatureTool';
  import { SIGNATURE_DRAG_TYPE } from '../lib/signature/layout';
  import {
    watermarkText,
    includeTimestamp,
    watermarkPosition,
    watermarkFontScale,
    watermarkColor,
    watermarkOpacity,
    currentWatermarkOptions,
    type WatermarkPosition,
  } from '../stores/watermark';
  import { lastPlacement } from '../stores/placement';
  import { fitWithinBox } from '../lib/signature/layout';
  import { buildWatermarkLines } from '../lib/watermark/visible';

  // One page of the document. PDFPages stacks one of these per page (only
  // for pages near the viewport) and owns loading the file.
  let { pageNumber, pdfDoc }: { pageNumber: number; pdfDoc: PdfDocument } = $props();

  let canvasEl: HTMLCanvasElement;
  let wrapperEl: HTMLDivElement;
  let textLayerEl: HTMLDivElement;
  let error: string | null = $state(null);
  let isDragOver = $state(false);
  let cursorPos = $state({ x: 0, y: 0 });
  // Click-to-place previews the signature under the cursor, on this page only.
  let pointerInside = $state(false);

  // Live preview of the watermark text, kept in sync with the export logic in lib/watermark/visible.ts.
  const previewLines = $derived(
    buildWatermarkLines({ customText: $watermarkText, includeTimestamp: $includeTimestamp }),
  );

  function positionToFlex(position: WatermarkPosition) {
    const [v, h] = position.split('-') as [string, string | undefined];
    const justifyContent = v === 'top' ? 'flex-start' : v === 'bottom' ? 'flex-end' : 'center';
    const alignItems = h === 'left' ? 'flex-start' : h === 'right' ? 'flex-end' : 'center';
    const textAlign = h === 'left' ? 'left' : h === 'right' ? 'right' : 'center';
    return { justifyContent, alignItems, textAlign };
  }

  const previewAlign = $derived(positionToFlex($watermarkPosition));

  const docId = $derived($activeDocument?.id ?? null);

  // Tracks whether there's a live (non-collapsed) selection anchored inside
  // the text layer, independent of hoverTextSelect/$textSelectMode — so that
  // after a hover-triggered selection and the pointer moving back out to
  // Move mode, the selected text stays interactive (right-click still hits
  // it, so the browser's own "Copy" context-menu item keeps working) instead
  // of the layer going pointer-events: none and silently losing the
  // selection to whatever's underneath. See textSelectActive below.
  let hasTextSelection = $state(false);
  // Whether a mouse button is held, so the Highlight button only appears once
  // a selection drag has finished rather than chasing the pointer.
  let pointerHeld = false;
  onMount(() => {
    function updateHasTextSelection() {
      const sel = window.getSelection();
      hasTextSelection = !!sel && !sel.isCollapsed && !!textLayerEl && !!sel.anchorNode && textLayerEl.contains(sel.anchorNode);
      if (pointerHeld || !hasTextSelection) {
        pendingHighlight = null;
        selectionFont = null;
      } else updatePendingHighlight();
    }
    function onPointerDown() {
      pointerHeld = true;
    }
    function onPointerUp() {
      pointerHeld = false;
      // The selection settles after the browser handles the release.
      setTimeout(() => {
        if (hasTextSelection) updatePendingHighlight();
      });
    }
    document.addEventListener('selectionchange', updateHasTextSelection);
    // Capture phase: overlays stop pointerdown from bubbling to the window.
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    return () => {
      document.removeEventListener('selectionchange', updateHasTextSelection);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
    };
  });

  // Markup: once text is selected, a small toolbar appears below it (like
  // Foxit's selection popup) to highlight, underline, or strike it through
  // permanently, in the chosen color — one box per line, saved as a PDF
  // markup annotation on export.
  let pendingHighlight: { boxes: Box[]; anchor: { x: number; y: number } } | null = $state(null);
  let selectedHighlightGroup: string | null = $state(null);
  // The page's on-screen rotation (its own /Rotate plus the user's). At
  // 90°/270° text runs top to bottom, which changes how selected spans join
  // into lines and which edge an underline sits on.
  let pageRotation = $state(0);
  const pageVertical = $derived(pageRotation % 180 !== 0);
  // About half the toolbar's width with a long font label.
  const MARKUP_POPUP_HALF_WIDTH = 240;

  function updatePendingHighlight() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !canvasEl) {
      pendingHighlight = null;
      return;
    }
    const canvasRect = canvasEl.getBoundingClientRect();
    const rects: Box[] = [];
    for (let i = 0; i < sel.rangeCount; i++) {
      for (const r of sel.getRangeAt(i).getClientRects()) {
        const left = clamp(r.left - canvasRect.left, 0, canvasRect.width);
        const top = clamp(r.top - canvasRect.top, 0, canvasRect.height);
        const right = clamp(r.right - canvasRect.left, 0, canvasRect.width);
        const bottom = clamp(r.bottom - canvasRect.top, 0, canvasRect.height);
        rects.push({ x: left, y: top, width: right - left, height: bottom - top });
      }
    }
    const boxes = selectionToBoxes(rects, pageVertical);
    if (boxes.length === 0) {
      pendingHighlight = null;
      return;
    }
    // Below the end of the selection, or above its start if there's no room.
    const last = boxes[boxes.length - 1];
    const first = boxes[0];
    const below = last.y + last.height + 40 < canvasRect.height;
    const halfWidth = Math.min(MARKUP_POPUP_HALF_WIDTH, canvasRect.width / 2);
    pendingHighlight = {
      boxes,
      anchor: {
        x: clamp(last.x + last.width, halfWidth, canvasRect.width - halfWidth),
        y: below ? last.y + last.height + 6 : Math.max(0, first.y - 38),
      },
    };
    updateSelectionFont(sel);
  }

  // The font of the selected text, as stored in the PDF (lib/pdf/fontInfo.ts),
  // shown at the start of the selection toolbar.
  let selectionFont: { label: string; detail: string } | null = $state(null);
  let fontRun = 0;

  function updateSelectionFont(sel: Selection) {
    const indices = new Set<number>();
    for (let i = 0; i < sel.rangeCount; i++) {
      for (const index of textItemIndices(textLayerEl, sel.getRangeAt(i))) indices.add(index);
    }
    const run = ++fontRun;
    selectionFonts(pdfDoc, pageNumber, [...indices].sort((a, b) => a - b))
      .then((fonts) => {
        if (run === fontRun) selectionFont = fontLabels(fonts);
      })
      .catch(() => {
        if (run === fontRun) selectionFont = null;
      });
  }

  // Applied on pointerdown (and click, for the keyboard): the selection is
  // still intact then, before the press could clear it.
  function applyPendingMarkup(e: Event, kind: MarkupKind) {
    e.preventDefault();
    e.stopPropagation();
    if (pendingHighlight) addMarkup(pendingHighlight.boxes, kind);
  }

  function addMarkup(boxes: Box[], kind: MarkupKind) {
    const doc = $activeDocument;
    if (!doc || boxes.length === 0) return;
    editorStore.addHighlight(pageNumber, boxes, kind, markupColorFor(kind, $markupColor));
    pendingHighlight = null;
    window.getSelection()?.removeAllRanges();
  }

  // Comment on selected text: the text is highlighted in the chosen color
  // and a note marker, attached to the highlight, opens beside it.
  function applyPendingComment(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    if (pendingHighlight) commentOnText(pendingHighlight.boxes);
  }

  function commentOnText(boxes: Box[]) {
    if (!$activeDocument || boxes.length === 0) return;
    if (editingCommentId) commitCommentEdit();
    const id = editorStore.addHighlight(pageNumber, boxes, 'highlight', $markupColor, noteBeside(boxes));
    pendingHighlight = null;
    window.getSelection()?.removeAllRanges();
    if (!id) return;
    newTextCommentId = id;
    selectedCommentId = id;
    startEditingComment(id, '');
  }

  /** Opens the note of a markup, adding one beside it if it has none. */
  function commentOnMarkup(groupId: string) {
    const doc = $activeDocument;
    if (!doc) return;
    if (editingCommentId) commitCommentEdit();
    selectedHighlightGroup = null;
    const existing = doc.comments.find((c) => c.groupId === groupId);
    if (existing) {
      selectedCommentId = existing.id;
      startEditingComment(existing.id, existing.text);
      return;
    }
    const boxes = doc.highlights.filter((h) => h.groupId === groupId);
    if (boxes.length === 0) return;
    const id = editorStore.addComment({ ...noteBeside(boxes), page: boxes[0].page, text: '', groupId });
    selectedCommentId = id;
    startEditingComment(id, '');
  }

  /** Where a markup's note marker goes: just past the end of its last line. */
  function noteBeside(boxes: Box[]): Box {
    const last = boxes[boxes.length - 1];
    const rect = canvasEl.getBoundingClientRect();
    const x = pageVertical ? last.x + last.width / 2 - COMMENT_SIZE / 2 : last.x + last.width + 4;
    const y = pageVertical ? last.y + last.height + 4 : last.y + last.height / 2 - COMMENT_SIZE / 2;
    return {
      x: clamp(x, 0, rect.width - COMMENT_SIZE),
      y: clamp(y, 0, rect.height - COMMENT_SIZE),
      width: COMMENT_SIZE,
      height: COMMENT_SIZE,
    };
  }

  // Picking a color keeps the selection, so a markup button can follow.
  function pickMarkupColor(e: Event, color: string) {
    e.preventDefault();
    e.stopPropagation();
    markupColor.set(color);
  }

  function removeHighlight(groupId: string) {
    editorStore.removeHighlight(groupId);
    if (selectedHighlightGroup === groupId) selectedHighlightGroup = null;
  }

  const viewRotation = $derived($activeDocument?.rotation ?? 0);

  // After a page edit or undo swaps the file, the page number can briefly point
  // past the end of the previous parse until the new one has loaded.
  const pageExists = $derived(pageNumber <= pdfDoc.numPages);

  // Re-render the page whenever the zoom level, rotation, or the file changes.
  // Reads only those values, not the whole $activeDocument, so edits don't
  // re-render every visible page.
  $effect(() => {
    const scale = $editorStore.renderScale;
    const rotation = viewRotation;
    if (!canvasEl || !pageExists) return;
    renderPageToCanvas(pdfDoc, pageNumber, canvasEl, scale, rotation).catch((e) => {
      error = e instanceof Error ? e.message : 'Failed to render PDF';
    });
  });

  // The selectable text overlay (see lib/pdf/textLayer.ts) is always built
  // alongside the canvas, even outside Select mode: the hover-to-select
  // behavior below needs the spans' real geometry to know whether the
  // pointer is sitting over text, and it's pointer-events: none (see the
  // markup below) unless textSelectActive is true, so it can't steal clicks
  // while inactive either way. Rebuilds on every page/scale/rotation/document
  // change like the canvas does above; renderTextLayer's own claim-tracking
  // (see textLayer.ts) handles cancelling a previous in-flight build when a
  // newer one starts.
  $effect(() => {
    const scale = $editorStore.renderScale;
    const rotation = viewRotation;

    if (!textLayerEl) return;
    if (!pageExists) {
      cancelTextLayer(textLayerEl);
      return;
    }

    renderTextLayer(pdfDoc, pageNumber, textLayerEl, scale, rotation)
      .then((handle) => {
        if (handle) textLayerVersion++;
      })
      .catch((e) => {
        error = e instanceof Error ? e.message : 'Failed to render selectable text';
      });

    return () => cancelTextLayer(textLayerEl);
  });

  // Find-in-document (SearchBar): every match on this page, boxed from the
  // rendered text layer once it's ready, with the current one stronger and
  // scrolled into view. Bumped each time the text layer finishes rendering.
  let textLayerVersion = $state(0);
  let searchHits: { boxes: Box[]; current: boolean }[] = $state([]);

  $effect(() => {
    void textLayerVersion;
    const { open, query, matches, current } = $search;
    const page = pageNumber;
    if (!open || !textLayerEl || !canvasEl || matches.length === 0) {
      searchHits = [];
      return;
    }
    const currentMatch = matches[current];
    const canvasRect = canvasEl.getBoundingClientRect();
    searchHits = findInTextLayer(textLayerEl, query).map((range, index) => {
      const rects = Array.from(range.getClientRects(), (r) => ({
        x: r.left - canvasRect.left,
        y: r.top - canvasRect.top,
        width: r.width,
        height: r.height,
      }));
      return {
        boxes: selectionToBoxes(rects, pageVertical),
        current: currentMatch?.page === page && currentMatch.index === index,
      };
    });
    // Scroll to each match once: this page re-runs this on every zoom and
    // whenever it scrolls back into view, which mustn't pull the view back.
    const key = `${query}\u0000${current}\u0000${matches.length}`;
    if (currentMatch?.page !== page || key === lastScrolledMatch) return;
    tick().then(() => {
      const el = wrapperEl?.querySelector('[data-search-current]');
      if (!el) return;
      lastScrolledMatch = key;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
  });

  // The PDF's own form fields on this page (lib/pdf/forms.ts), positioned in
  // canvas pixels. pdf.js leaves form widgets out of the canvas render, so
  // these HTML inputs are what the user sees and types into. Recomputed only
  // when the page view changes, not on every edit.
  type FormBox = FormWidget & { left: number; top: number; boxWidth: number; boxHeight: number; fontPx: number };
  let formBoxes: FormBox[] = $state([]);
  const formValues = $derived($activeDocument?.formValues ?? {});

  $effect(() => {
    const loaded = pdfDoc;
    const rotation = viewRotation;
    const scale = $editorStore.renderScale;
    if (!pageExists) {
      formBoxes = [];
      return;
    }
    let cancelled = false;
    Promise.all([getPageFormWidgets(loaded, pageNumber), loaded.getPage(pageNumber)])
      .then(([widgets, page]) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale, rotation: getTotalRotation(page, rotation) });
        formBoxes = widgets.map((w) => {
          const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(w.rect);
          const boxWidth = Math.abs(x2 - x1);
          const boxHeight = Math.abs(y2 - y1);
          // A size of 0 in the PDF means "fit the box", like readers do; a set
          // size is still capped so it can't overflow the box.
          const fontPx = w.multiLine
            ? Math.min(w.fontSize > 0 ? w.fontSize : 10, 14) * scale
            : Math.min(w.fontSize > 0 ? w.fontSize * scale : 12 * scale, boxHeight * 0.75);
          return { ...w, left: Math.min(x1, x2), top: Math.min(y1, y2), boxWidth, boxHeight, fontPx };
        });
      })
      .catch(() => {
        if (!cancelled) formBoxes = [];
      });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const loaded = pdfDoc;
    const rotation = viewRotation;
    if (!pageExists) return;
    let cancelled = false;
    loaded
      .getPage(pageNumber)
      .then((page) => {
        if (!cancelled) pageRotation = getTotalRotation(page, rotation);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  // Fields only take input in the default Move mode, so they never swallow a
  // click meant for a tool (placing text, drawing a redaction, …).
  const formFieldsInteractive = $derived(
    !$redactMode &&
      !$textToolMode &&
      !$commentToolMode &&
      !$clickToPlaceMode &&
      !$textSelectMode &&
      !$screenshotToolMode &&
      !$shapeToolMode &&
      !$cropToolMode &&
      !$ocrAreaMode,
  );

  // Move mode auto-switches into text selection when the pointer rests over
  // real text for HOVER_SELECT_DELAY, so the user doesn't have to click the
  // toolbar's Select button first. It then stays in text selection for as
  // long as the pointer keeps moving over text, and reverts to Move (the
  // hand) as soon as it leaves the text. The manual Select toggle
  // ($textSelectMode) is unaffected and stays sticky either way.
  const HOVER_SELECT_DELAY = 300;
  // Slack around each span, so the small gaps between words and lines don't
  // flicker back to the hand while moving across a paragraph.
  const HOVER_TEXT_MARGIN = 6;
  let hoverTextSelect = $state(false);
  let hoverCheckTimer: ReturnType<typeof setTimeout> | undefined;
  const textSelectActive = $derived($textSelectMode || hoverTextSelect || hasTextSelection);

  function clearHoverTimer() {
    clearTimeout(hoverCheckTimer);
    hoverCheckTimer = undefined;
  }

  // Geometric hit test against the text layer's own spans rather than
  // elementFromPoint/elementsFromPoint: those respect pointer-events, and the
  // text layer is deliberately pointer-events: none until textSelectActive is
  // already true — exactly the thing this check exists to decide.
  function isPointOverText(clientX: number, clientY: number, margin = 0): boolean {
    if (!textLayerEl) return false;
    const spans = textLayerEl.querySelectorAll('span');
    for (const span of spans) {
      const rect = span.getBoundingClientRect();
      if (
        clientX >= rect.left - margin &&
        clientX <= rect.right + margin &&
        clientY >= rect.top - margin &&
        clientY <= rect.bottom + margin
      ) {
        return true;
      }
    }
    return false;
  }

  // While the text layer takes pointer events, landing directly on one of
  // its spans answers the question without measuring every span.
  function isPointerOverText(e: PointerEvent, margin: number): boolean {
    const target = e.target as Element | null;
    if (target?.tagName === 'SPAN' && textLayerEl?.contains(target)) return true;
    return isPointOverText(e.clientX, e.clientY, margin);
  }

  function updateHoverTextSelect(e: PointerEvent) {
    const explicitToolActive =
      $redactMode ||
      $textToolMode ||
      $commentToolMode ||
      $clickToPlaceMode ||
      $textSelectMode ||
      $screenshotToolMode ||
      $shapeToolMode ||
      $cropToolMode ||
      $ocrAreaMode;
    const otherInteractionInProgress =
      isPanning ||
      drawingBox ||
      movingSignatureId ||
      movingRedactionId ||
      movingTextId ||
      movingCommentId ||
      resizingSignatureId ||
      resizingRedactionId ||
      resizingTextId ||
      drawingShape ||
      !!(e.target as Element | null)?.closest?.('[data-placed-box]');

    if (explicitToolActive || otherInteractionInProgress) {
      clearHoverTimer();
      hoverTextSelect = false;
      return;
    }

    // A held button while already hover-active means the user is mid-drag
    // extending a text selection they just entered — that's forward
    // progress, not "moved away," so leave the mode alone until they let go.
    if (hoverTextSelect && e.buttons !== 0) return;

    // Already selecting and still over text — stay put.
    if (hoverTextSelect && isPointerOverText(e, HOVER_TEXT_MARGIN)) return;

    clearHoverTimer();
    hoverTextSelect = false;

    const { clientX, clientY } = e;
    hoverCheckTimer = setTimeout(() => {
      if (isPointOverText(clientX, clientY)) hoverTextSelect = true;
    }, HOVER_SELECT_DELAY);
  }

  function onWrapperPointerLeave() {
    clearHoverTimer();
    hoverTextSelect = false;
    pointerInside = false;
  }

  // What's been placed on this page.
  const signaturesOnCurrentPage = $derived(
    $activeDocument?.placedSignatures.filter((sig) => sig.page === pageNumber) ?? [],
  );
  const redactionsOnCurrentPage = $derived($activeDocument?.redactions.filter((box) => box.page === pageNumber) ?? []);
  const textsOnCurrentPage = $derived($activeDocument?.texts.filter((t) => t.page === pageNumber) ?? []);
  // Page number, header, and footer, previewed as lib/pdf/headerFooter.ts
  // will draw them.
  const edgeLabels = $derived(
    $activeDocument
      ? pageLabels(
          $activeDocument.pageNumbers,
          $activeDocument.headerFooter,
          pageNumber,
          $activeDocument.pageCount,
          $activeDocument.file.name,
          headerFooterDate(),
        )
      : [],
  );
  // The watermark, previewed as lib/pdf/pageWatermark.ts lays it out (in
  // points on the page as shown).
  let pagePoints: { width: number; height: number } | null = $state(null);
  $effect(() => {
    const rotation = viewRotation;
    if (!pageExists) return;
    let cancelled = false;
    pdfDoc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1, rotation: getTotalRotation(page, rotation) });
        pagePoints = { width: viewport.width, height: viewport.height };
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });
  const watermark = $derived($activeDocument?.pageWatermark ?? null);
  const watermarkImage = $derived(
    watermark?.kind === 'image' && watermark.imageId ? imageFor(watermark.imageId) : undefined,
  );
  const watermarkStamps = $derived.by(() => {
    if (!watermark || !pagePoints) return [];
    const size = watermarkSize(watermark, pagePoints.width, watermarkImage);
    if (!size) return [];
    return watermarkCenters(watermark, size, pagePoints.width, pagePoints.height).map(([x, y]) => ({ x, y, ...size }));
  });
  const commentsOnCurrentPage = $derived($activeDocument?.comments.filter((c) => c.page === pageNumber) ?? []);
  const highlightsOnCurrentPage = $derived($activeDocument?.highlights.filter((h) => h.page === pageNumber) ?? []);
  const shapesOnCurrentPage = $derived($activeDocument?.shapes.filter((s) => s.page === pageNumber) ?? []);
  const imagesOnCurrentPage = $derived($activeDocument?.images.filter((img) => img.page === pageNumber) ?? []);

  function canvasBounds() {
    const rect = canvasEl.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  const isLineKind = (kind: ShapeKind) => kind === 'line' || kind === 'arrow';
  const SHAPE_LABELS: Record<ShapeKind, string> = {
    rectangle: 'Rectangle',
    ellipse: 'Ellipse',
    line: 'Line',
    arrow: 'Arrow',
  };

  // Shapes tool: drag on the page to draw the chosen shape (Shift keeps a
  // square, a circle, or a line at 45° steps); a plain click drops one of a
  // default size. The tool stays on, so several can be drawn in a row.
  const SHAPE_DRAW_MIN = 6;
  let drawingShape: { x: number; y: number; width: number; height: number; flipX: boolean; flipY: boolean } | null =
    $state(null);
  let shapeStart = { x: 0, y: 0 };

  $effect(() => {
    if (!$shapeToolMode) drawingShape = null;
  });

  function shapeDraft(e: PointerEvent) {
    const rect = canvasEl.getBoundingClientRect();
    let endX = clamp(e.clientX - rect.left, 0, rect.width);
    let endY = clamp(e.clientY - rect.top, 0, rect.height);
    if (e.shiftKey) {
      const dx = endX - shapeStart.x;
      const dy = endY - shapeStart.y;
      if (isLineKind($shapeKind)) {
        const step = Math.PI / 4;
        const angle = Math.round(Math.atan2(dy, dx) / step) * step;
        const length = Math.hypot(dx, dy);
        endX = clamp(shapeStart.x + Math.round(Math.cos(angle) * length), 0, rect.width);
        endY = clamp(shapeStart.y + Math.round(Math.sin(angle) * length), 0, rect.height);
      } else {
        const size = Math.max(Math.abs(dx), Math.abs(dy));
        endX = clamp(shapeStart.x + (dx < 0 ? -size : size), 0, rect.width);
        endY = clamp(shapeStart.y + (dy < 0 ? -size : size), 0, rect.height);
      }
    }
    return {
      x: Math.min(shapeStart.x, endX),
      y: Math.min(shapeStart.y, endY),
      width: Math.abs(endX - shapeStart.x),
      height: Math.abs(endY - shapeStart.y),
      flipX: endX < shapeStart.x,
      flipY: endY < shapeStart.y,
    };
  }

  function finishShape(box: NonNullable<typeof drawingShape>) {
    const kind = $shapeKind;
    const scale = $editorStore.renderScale;
    let geometry = box;
    // A click rather than a drag: a shape of a default size, centred there.
    if (Math.max(box.width, box.height) < SHAPE_DRAW_MIN) {
      const rect = canvasEl.getBoundingClientRect();
      const width = Math.min(80 * scale, rect.width);
      const height = isLineKind(kind) ? 0 : Math.min(54 * scale, rect.height);
      geometry = {
        x: clamp(box.x - width / 2, 0, rect.width - width),
        y: clamp(box.y - height / 2, 0, rect.height - height),
        width,
        height,
        flipX: false,
        flipY: false,
      };
    }
    $selectedShapeId = editorStore.addShape({
      ...geometry,
      page: pageNumber,
      kind,
      stroke: $shapeStroke,
      strokeWidth: (isLineKind(kind) ? Math.max(1, $shapeStrokeWidth) : $shapeStrokeWidth) * scale,
      fill: isLineKind(kind) ? null : $shapeFill,
      opacity: $shapeOpacity,
    });
  }

  // Images: placed from the toolbar's Add image (on the page in view), by
  // dropping an image file onto a page, or from the page's right-click menu.
  // They start at most 40% of the page across, centred on the point given
  // or on the visible part of the page.
  let selectedImageId: string | null = $state(null);
  let imageInputEl: HTMLInputElement | undefined = $state();
  let imageMenuPoint: ClientPoint | null = null;
  let imageError: string | null = $state(null);

  function placeImage(image: { id: string; width: number; height: number }, at?: ClientPoint) {
    if (!$activeDocument || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    const fit = Math.min(1, (rect.width * 0.4) / image.width, (rect.height * 0.4) / image.height);
    const width = image.width * fit;
    const height = image.height * fit;
    let centerX = rect.width / 2;
    let centerY = rect.height / 2;
    if (at) {
      centerX = at.clientX - rect.left;
      centerY = at.clientY - rect.top;
    } else {
      const view = wrapperEl.closest('[data-pdf-scroll-container]')?.getBoundingClientRect();
      if (view) {
        const top = Math.max(rect.top, view.top);
        const bottom = Math.min(rect.bottom, view.bottom);
        if (bottom > top) centerY = (top + bottom) / 2 - rect.top;
      }
    }
    selectedImageId = editorStore.addImage({
      imageId: image.id,
      x: clamp(centerX - width / 2, 0, rect.width - width),
      y: clamp(centerY - height / 2, 0, rect.height - height),
      width,
      height,
      page: pageNumber,
      opacity: 1,
    });
  }

  function addImageAt(file: File, at?: ClientPoint) {
    imageError = null;
    addImageFile(file)
      .then((image) => placeImage(image, at))
      .catch((err) => {
        imageError = err instanceof Error ? err.message : 'Failed to add the image';
        setTimeout(() => (imageError = null), 6000);
      });
  }

  // The toolbar's Add image lands on the page being viewed.
  $effect(() => {
    const pending = $pendingImage;
    if (!pending || !canvasEl || pageNumber !== ($activeDocument?.pageNumber ?? 1)) return;
    untrack(() => {
      pendingImage.set(null);
      placeImage(pending);
    });
  });

  // The move/resize/remove controls only show while a signature is
  // "selected" — right after it's placed, or after the user clicks it again
  // — and hide once the user clicks anywhere else, so signatures don't
  // permanently sit under a distracting border and handles.
  let selectedSignatureId: string | null = $state(null);

  function onWindowPointerDown(e: PointerEvent) {
    menuToken++;
    const current = selectedSignatureId
      ? wrapperEl?.querySelector(`[data-placed-signature="${selectedSignatureId}"]`)
      : null;
    if (!current?.contains(e.target as Node)) selectedSignatureId = null;

    const currentRedaction = selectedRedactionId
      ? wrapperEl?.querySelector(`[data-redaction="${selectedRedactionId}"]`)
      : null;
    if (!currentRedaction?.contains(e.target as Node)) selectedRedactionId = null;

    if ((e.target as Element | null)?.closest?.('[data-highlight-group]')?.getAttribute('data-highlight-group') !== selectedHighlightGroup) {
      selectedHighlightGroup = null;
    }

    // Deliberately doesn't touch editingTextId/commitTextEdit here: this
    // handler fires on the same pointerdown that creates a brand-new text
    // box, and at that point Svelte hasn't painted the box into the DOM yet
    // — the querySelector below would find nothing and wrongly treat the
    // just-opened box as "clicked outside," discarding it before the user
    // can type. The textarea's own onblur is the sole authority for
    // committing/discarding an edit; it only fires once the element genuinely
    // existed and had focus, so it doesn't have this race.
    // Clicks in the tool panel keep the box selected: that's where it's styled.
    // The selection is shared by every page, so only the page holding the
    // selected box decides.
    const currentText =
      $selectedTextId && textsOnCurrentPage.some((t) => t.id === $selectedTextId)
        ? wrapperEl?.querySelector(`[data-placed-text="${$selectedTextId}"]`)
        : undefined;
    const inToolPanel = !!(e.target as Element | null)?.closest?.('[data-tool-panel]');
    if (
      currentText !== undefined &&
      !currentText?.contains(e.target as Node) &&
      !inToolPanel &&
      editingTextId !== $selectedTextId
    ) {
      $selectedTextId = null;
    }

    // Same reasoning as currentText above — the just-created comment marker
    // isn't painted into the DOM yet on the pointerdown that creates it.
    const currentComment = selectedCommentId
      ? wrapperEl?.querySelector(`[data-placed-comment="${selectedCommentId}"]`)
      : null;
    if (!currentComment?.contains(e.target as Node) && editingCommentId !== selectedCommentId) {
      if (editingCommentId) commitCommentEdit();
      selectedCommentId = null;
    }

    // Clicking anywhere outside the selectable-text layer collapses any
    // active PDF text selection, like clicking away normally does — needed
    // explicitly because that layer goes pointer-events: none again as soon
    // as the click lands elsewhere (see textSelectActive), so there's no
    // guarantee the browser's own native "click away clears selection"
    // behavior fires on an element that isn't even receiving the click.
    // Only the page the selection is on clears it, so a shift-click on that
    // page isn't undone by the others.
    const selection = window.getSelection();
    if (hasTextSelection && selection && !selection.isCollapsed && !textLayerEl?.contains(e.target as Node)) {
      selection.removeAllRanges();
    }
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  // Remember where the signature was placed (as a ratio of the page size) so
  // it can be reused on the next document.
  function rememberPlacement(placement: PlacedSignature) {
    const rect = canvasEl.getBoundingClientRect();
    lastPlacement.set({
      xRatio: placement.x / rect.width,
      yRatio: placement.y / rect.height,
      widthRatio: placement.width / rect.width,
      heightRatio: placement.height / rect.height,
      ...(placement.angle && { angle: placement.angle }),
    });
  }

  // Thumbnails being reordered in the page sidebar aren't signatures.
  function isPageDrag(e: DragEvent) {
    return !!e.dataTransfer?.types.includes(PAGE_DRAG_TYPE);
  }

  function onDragOver(e: DragEvent) {
    if (isPageDrag(e)) return;
    e.preventDefault();
    isDragOver = true;
  }

  function onDrop(e: DragEvent) {
    if (isPageDrag(e)) return;
    e.preventDefault();
    isDragOver = false;
    // The signature panel tags each dragged signature with its id. Checked
    // first: Chrome also attaches a dragged <img> as a file, which would
    // otherwise be added as a plain image, without the watermark.
    const signatureId = e.dataTransfer?.getData(SIGNATURE_DRAG_TYPE);
    if (signatureId) {
      placeSignatureAt(e, signatureId);
      return;
    }
    const imageFile = Array.from(e.dataTransfer?.files ?? []).find(isImageFile);
    if (imageFile) {
      addImageAt(imageFile, { clientX: e.clientX, clientY: e.clientY });
      return;
    }
    placeSignatureAt(e);
  }

  function onCanvasMouseMove(e: PointerEvent) {
    const rect = canvasEl.getBoundingClientRect();
    cursorPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    pointerInside = true;
  }

  function onCanvasClick(e: PointerEvent) {
    // Right-click opens the context menu rather than using the tool.
    if ($redactMode || e.button !== 0) return;

    if ($textToolMode) {
      // preventDefault stops the browser's own default action for this
      // pointerdown — normally "focus whatever's focusable at the target, or
      // else blur the current focus" — which otherwise runs right after this
      // handler returns and immediately steals focus back off the textarea
      // addTextAt is about to create and focus (canvas itself isn't
      // focusable, so the default action would just blur it).
      // stopPropagation stops this same pointerdown from also reaching the
      // window-level listener below: that listener closes the editor for
      // whatever text box isn't under the click, but Svelte hasn't painted
      // the just-created textarea into the DOM yet at this point in the same
      // event, so its "is this click inside the box" check would wrongly see
      // no box there and immediately close the one just opened.
      e.preventDefault();
      e.stopPropagation();
      // Add Text mode stays on after placing one box (so several can be
      // added in a row), so a click elsewhere on the canvas to start a new
      // box arrives here too — commit whatever's currently being edited
      // first, otherwise reassigning editingTextId to the new box below
      // would discard the previous one's typed text unsaved.
      if (editingTextId) commitTextEdit();
      addTextAt(e);
      return;
    }

    if ($commentToolMode) {
      // Same reasoning as the Add Text branch above — prevent focus theft and
      // stop this pointerdown from also reaching the window-level "click
      // outside closes the editor" listener before the new marker is painted.
      e.preventDefault();
      e.stopPropagation();
      if (editingCommentId) commitCommentEdit();
      addCommentAt(e);
      return;
    }

    if (!$clickToPlaceMode) return;
    placeSignatureAt(e);
  }

  type ClientPoint = { clientX: number; clientY: number };

  /** Places a saved signature (the active one unless given) centered on a point of the page. */
  function placeSignatureAt(e: ClientPoint, signatureId?: string) {
    const doc = $activeDocument;
    if (!doc) return;

    const sig = resolveSignature($signatureStore, signatureId);
    if (!sig) return;

    const { width, height } = fitWithinBox(sig.naturalWidth, sig.naturalHeight);
    const rect = canvasEl.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left - width / 2, 0, rect.width - width);
    const y = clamp(e.clientY - rect.top - height / 2, 0, rect.height - height);

    const placement = { x, y, width, height, page: pageNumber, signatureId: sig.id };
    const id = editorStore.addSignature(placement);
    rememberPlacement({ ...placement, id });
    selectedSignatureId = id;
  }

  // Let placed signatures be moved after they're dropped.
  let movingSignatureId: string | null = null;
  let moveOffset = { x: 0, y: 0 };

  function onSignaturePointerDown(e: PointerEvent, id: string) {
    e.stopPropagation();
    selectedSignatureId = id;
    movingSignatureId = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    // From the box's own corner, not the element's on-screen bounds, which grow when it's turned.
    const sig = $activeDocument?.placedSignatures.find((s) => s.id === id);
    const canvasRect = canvasEl.getBoundingClientRect();
    moveOffset = sig
      ? { x: e.clientX - canvasRect.left - sig.x, y: e.clientY - canvasRect.top - sig.y }
      : { x: 0, y: 0 };
  }

  function onSignaturePointerMove(e: PointerEvent, id: string) {
    if (movingSignatureId !== id) return;
    const sig = $activeDocument?.placedSignatures.find((s) => s.id === id);
    if (!sig) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left - moveOffset.x, 0, rect.width - sig.width);
    const y = clamp(e.clientY - rect.top - moveOffset.y, 0, rect.height - sig.height);
    editorStore.updateSignature(id, { x, y });
  }

  function onSignaturePointerUp() {
    if (movingSignatureId) {
      const sig = $activeDocument?.placedSignatures.find((s) => s.id === movingSignatureId);
      if (sig) rememberPlacement(sig);
    }
    movingSignatureId = null;
  }

  // Nudge a signature with the arrow keys while its control box (the resize
  // handle / remove button) is showing — lets keyboard users reposition it
  // without needing to drag.
  const KEYBOARD_MOVE_STEP = 10;

  function onSignatureKeydown(e: KeyboardEvent, id: string) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      editorStore.removeSignature(id);
      if (selectedSignatureId === id) selectedSignatureId = null;
      return;
    }

    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) return;
    e.preventDefault();

    const sig = $activeDocument?.placedSignatures.find((s) => s.id === id);
    if (!sig) return;

    const rect = canvasEl.getBoundingClientRect();
    const dx = e.key === 'ArrowLeft' ? -KEYBOARD_MOVE_STEP : e.key === 'ArrowRight' ? KEYBOARD_MOVE_STEP : 0;
    const dy = e.key === 'ArrowUp' ? -KEYBOARD_MOVE_STEP : e.key === 'ArrowDown' ? KEYBOARD_MOVE_STEP : 0;

    const x = clamp(sig.x + dx, 0, rect.width - sig.width);
    const y = clamp(sig.y + dy, 0, rect.height - sig.height);
    editorStore.updateSignature(id, { x, y });
    rememberPlacement({ ...sig, x, y });
  }

  // Resize via the corner handle, always preserving the signature's aspect ratio.
  const MIN_SIZE = 24;
  const KEYBOARD_RESIZE_STEP = 10;
  let resizingSignatureId: string | null = null;
  let resizeStart: (PlacedSignature & { pointerX: number; pointerY: number }) | null = null;

  function onSignatureResizeKeydown(e: KeyboardEvent, id: string) {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();

    const sig = $activeDocument?.placedSignatures.find((s) => s.id === id);
    if (!sig) return;

    const grow = e.key === 'ArrowUp' || e.key === 'ArrowRight';
    const resized = resizedFromCorner(sig, sig.width + (grow ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP));
    editorStore.updateSignature(id, resized);
    rememberPlacement({ ...sig, ...resized });
  }

  // The new box for a resize toward `targetWidth`, with the corner across
  // from the handle (the top-left one, turned with the signature) kept in place.
  function resizedFromCorner(origin: PlacedSignature, targetWidth: number) {
    const { width, height } = clampedResize(targetWidth, origin);
    if (!origin.angle) return { width, height };
    const a = (origin.angle * Math.PI) / 180;
    const turn = (dx: number, dy: number) => [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
    // The fixed corner, from the old centre, then the new centre from it.
    const [ox, oy] = turn(-origin.width / 2, -origin.height / 2);
    const [nx, ny] = turn(width / 2, height / 2);
    const cx = origin.x + origin.width / 2 + ox + nx;
    const cy = origin.y + origin.height / 2 + oy + ny;
    return { width, height, x: cx - width / 2, y: cy - height / 2 };
  }

  // Shared by the pointer-drag and keyboard paths: grows/shrinks toward
  // `targetWidth` from `origin`'s position, preserving aspect ratio and
  // clamping so the signature never overflows the page or drops below MIN_SIZE.
  function clampedResize(targetWidth: number, origin: PlacedSignature): { width: number; height: number } {
    const rect = canvasEl.getBoundingClientRect();
    const aspect = origin.width / origin.height;
    // A turned signature grows from its turned corner, so the page edges
    // only limit it to the page's own size.
    const turned = !!origin.angle;

    let width = clamp(targetWidth, MIN_SIZE, turned ? rect.width : rect.width - origin.x);
    let height = width / aspect;

    const maxHeight = turned ? rect.height : rect.height - origin.y;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspect;
    }
    if (height < MIN_SIZE) {
      height = MIN_SIZE;
      width = height * aspect;
    }

    return { width, height };
  }

  function onSignatureResizePointerDown(e: PointerEvent, id: string) {
    e.stopPropagation();
    const sig = $activeDocument?.placedSignatures.find((s) => s.id === id);
    if (!sig) return;
    resizingSignatureId = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeStart = { pointerX: e.clientX, pointerY: e.clientY, ...sig };
  }

  function onSignatureResizePointerMove(e: PointerEvent, id: string) {
    if (resizingSignatureId !== id || !resizeStart) return;
    // How far the pointer moved along the signature's own width, turned with it.
    const a = ((resizeStart.angle ?? 0) * Math.PI) / 180;
    const along = (e.clientX - resizeStart.pointerX) * Math.cos(a) + (e.clientY - resizeStart.pointerY) * Math.sin(a);
    editorStore.updateSignature(id, resizedFromCorner(resizeStart, resizeStart.width + along));
  }

  // Turn via the handle above the signature: it points from the centre to
  // the pointer, snapping to upright and the quarter turns when close, and
  // to steps of 15° with Shift.
  const ROTATE_SNAP = 5;
  const KEYBOARD_ROTATE_STEP = 15;
  let rotatingSignatureId: string | null = null;
  let rotateCentre = { x: 0, y: 0 };

  function normalizedAngle(angle: number): number | undefined {
    const a = ((Math.round(angle) % 360) + 360) % 360;
    return a === 0 ? undefined : a;
  }

  function onSignatureRotatePointerDown(e: PointerEvent, id: string) {
    e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).closest('[data-placed-signature]')?.getBoundingClientRect();
    if (!box) return;
    rotatingSignatureId = id;
    rotateCentre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onSignatureRotatePointerMove(e: PointerEvent, id: string) {
    if (rotatingSignatureId !== id) return;
    // 0° is the handle straight above the centre.
    let angle = (Math.atan2(e.clientY - rotateCentre.y, e.clientX - rotateCentre.x) * 180) / Math.PI + 90;
    if (e.shiftKey) angle = Math.round(angle / 15) * 15;
    else {
      const quarter = Math.round(angle / 90) * 90;
      if (Math.abs(angle - quarter) < ROTATE_SNAP) angle = quarter;
    }
    editorStore.updateSignature(id, { angle: normalizedAngle(angle) });
  }

  function onSignatureRotatePointerUp(e: PointerEvent) {
    if (rotatingSignatureId) {
      const sig = $activeDocument?.placedSignatures.find((s) => s.id === rotatingSignatureId);
      if (sig) rememberPlacement(sig);
    }
    rotatingSignatureId = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  // Opens the signature panel with this placement's signature as the active one.
  function editSignature(id: string) {
    const placed = $activeDocument?.placedSignatures.find((s) => s.id === id);
    if (placed && $signatureStore.signatures.some((s) => s.id === placed.signatureId)) {
      signatureStore.setActive(placed.signatureId);
    }
    selectedSignatureId = id;
    openSignatureTool();
  }

  function rotateSignatureBy(id: string, delta: number) {
    const sig = $activeDocument?.placedSignatures.find((s) => s.id === id);
    if (!sig) return;
    const angle = normalizedAngle((sig.angle ?? 0) + delta);
    editorStore.updateSignature(id, { angle });
    rememberPlacement({ ...sig, angle });
  }

  function onSignatureRotateKeydown(e: KeyboardEvent, id: string) {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 1 : KEYBOARD_ROTATE_STEP;
    rotateSignatureBy(id, e.key === 'ArrowRight' || e.key === 'ArrowDown' ? step : -step);
  }

  function onSignatureResizePointerUp(e: PointerEvent) {
    if (resizingSignatureId) {
      const sig = $activeDocument?.placedSignatures.find((s) => s.id === resizingSignatureId);
      if (sig) rememberPlacement(sig);
    }
    resizingSignatureId = null;
    resizeStart = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function removeSignature(e: MouseEvent, id: string) {
    e.stopPropagation();
    editorStore.removeSignature(id);
    if (selectedSignatureId === id) selectedSignatureId = null;
  }

  // Redaction: draw-a-box mode. While active, a plain pointer drag directly on
  // the canvas (not on an existing overlay — those stop being `e.target` once
  // something is stacked on top of them) starts a new box; releasing commits
  // it if it's big enough to be a deliberate box rather than a stray click.
  const REDACT_DRAW_MIN_SIZE = 8;
  let selectedRedactionId: string | null = $state(null);
  let drawingBox: { x: number; y: number; width: number; height: number } | null = $state(null);
  let drawStart = { x: 0, y: 0 };

  $effect(() => {
    if (!$redactMode) drawingBox = null;
  });

  // Move mode (the default — see FloatingControls' "Move" button): a plain
  // pointer drag directly on the canvas background (not on an overlay, and
  // not one of the other click-driven modes) pans the scrollable viewport
  // instead, like the hand tool in Figma/Photoshop. The scroll container
  // lives in App.svelte, outside this component, so it's found via the
  // nearest ancestor carrying data-pdf-scroll-container rather than prop-drilled.
  let isPanning = false;
  let panStart = { x: 0, y: 0, scrollLeft: 0, scrollTop: 0 };
  let panScrollContainer: HTMLElement | null = null;

  function canPanFrom(e: PointerEvent): boolean {
    return (
      !$redactMode &&
      !$textToolMode &&
      !$commentToolMode &&
      !$clickToPlaceMode &&
      !$shapeToolMode &&
      !$cropToolMode &&
      !$ocrAreaMode &&
      !textSelectActive &&
      e.target === canvasEl
    );
  }

  function onWrapperPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if ($redactMode && e.target === canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 0, rect.width);
      const y = clamp(e.clientY - rect.top, 0, rect.height);
      drawStart = { x, y };
      drawingBox = { x, y, width: 0, height: 0 };
      selectedRedactionId = null;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if ($shapeToolMode && e.target === canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      shapeStart = { x: clamp(e.clientX - rect.left, 0, rect.width), y: clamp(e.clientY - rect.top, 0, rect.height) };
      drawingShape = { ...shapeStart, width: 0, height: 0, flipX: false, flipY: false };
      $selectedShapeId = null;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (canPanFrom(e)) {
      panScrollContainer = wrapperEl?.closest('[data-pdf-scroll-container]') as HTMLElement | null;
      if (!panScrollContainer) return;
      isPanning = true;
      panStart = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: panScrollContainer.scrollLeft,
        scrollTop: panScrollContainer.scrollTop,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  }

  function onWrapperPointerMove(e: PointerEvent) {
    updateHoverTextSelect(e);

    if (drawingShape) {
      drawingShape = shapeDraft(e);
      return;
    }

    if (drawingBox) {
      const rect = canvasEl.getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 0, rect.width);
      const y = clamp(e.clientY - rect.top, 0, rect.height);
      drawingBox = {
        x: Math.min(x, drawStart.x),
        y: Math.min(y, drawStart.y),
        width: Math.abs(x - drawStart.x),
        height: Math.abs(y - drawStart.y),
      };
      return;
    }

    if (isPanning && panScrollContainer) {
      panScrollContainer.scrollLeft = panStart.scrollLeft - (e.clientX - panStart.x);
      panScrollContainer.scrollTop = panStart.scrollTop - (e.clientY - panStart.y);
    }
  }

  function onWrapperPointerUp(e: PointerEvent) {
    if (drawingShape) {
      const box = shapeDraft(e);
      drawingShape = null;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      finishShape(box);
      return;
    }

    if (drawingBox) {
      const doc = $activeDocument;
      const box = drawingBox;
      drawingBox = null;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      if (!doc || box.width < REDACT_DRAW_MIN_SIZE || box.height < REDACT_DRAW_MIN_SIZE) return;
      editorStore.addRedaction({ ...box, page: pageNumber });
      return;
    }

    if (isPanning) {
      isPanning = false;
      panScrollContainer = null;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  }

  // Screenshot tool: a click (or a drag too small to be deliberate) captures
  // the whole page; a drag captures just the rectangle drawn. See
  // lib/pdf/screenshot.ts — the area is handed over as fractions of the page
  // so the capture can be rendered at its own, higher resolution.
  const SHOT_DRAW_MIN_SIZE = 8;
  let shotBox: { x: number; y: number; width: number; height: number } | null = $state(null);
  let shotStart = { x: 0, y: 0 };
  let capturing = $state(false);

  $effect(() => {
    if (!$screenshotToolMode) shotBox = null;
  });

  function shotPoint(e: PointerEvent) {
    const rect = canvasEl.getBoundingClientRect();
    return { x: clamp(e.clientX - rect.left, 0, rect.width), y: clamp(e.clientY - rect.top, 0, rect.height) };
  }

  function onShotPointerDown(e: PointerEvent) {
    if (e.button !== 0 || capturing) return;
    e.stopPropagation();
    shotStart = shotPoint(e);
    shotBox = { ...shotStart, width: 0, height: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onShotPointerMove(e: PointerEvent) {
    if (!shotBox) return;
    const { x, y } = shotPoint(e);
    shotBox = {
      x: Math.min(x, shotStart.x),
      y: Math.min(y, shotStart.y),
      width: Math.abs(x - shotStart.x),
      height: Math.abs(y - shotStart.y),
    };
  }

  function onShotPointerUp(e: PointerEvent) {
    const box = shotBox;
    shotBox = null;
    if (!box) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    const rect = canvasEl.getBoundingClientRect();
    const isArea = box.width >= SHOT_DRAW_MIN_SIZE && box.height >= SHOT_DRAW_MIN_SIZE;
    const area = isArea
      ? { x: box.x / rect.width, y: box.y / rect.height, width: box.width / rect.width, height: box.height / rect.height }
      : null;
    capturePageImage(area, $screenshotDestination);
  }

  // Recognize text in an area: the same drag as a screenshot, handed to
  // stores/ocr.ts as fractions of the page as shown. A click without a drag
  // does nothing, so the user can still scroll to another page to drag on.
  let ocrBox: { x: number; y: number; width: number; height: number } | null = $state(null);
  let ocrStart = { x: 0, y: 0 };

  $effect(() => {
    if (!$ocrAreaMode) ocrBox = null;
  });

  function onOcrPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    ocrStart = shotPoint(e);
    ocrBox = { ...ocrStart, width: 0, height: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onOcrPointerMove(e: PointerEvent) {
    if (!ocrBox) return;
    const { x, y } = shotPoint(e);
    ocrBox = {
      x: Math.min(x, ocrStart.x),
      y: Math.min(y, ocrStart.y),
      width: Math.abs(x - ocrStart.x),
      height: Math.abs(y - ocrStart.y),
    };
  }

  function onOcrPointerUp(e: PointerEvent) {
    const box = ocrBox;
    ocrBox = null;
    if (!box) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (box.width < SHOT_DRAW_MIN_SIZE || box.height < SHOT_DRAW_MIN_SIZE) return;
    const rect = canvasEl.getBoundingClientRect();
    recognizeTextInArea(pageNumber, {
      x: box.x / rect.width,
      y: box.y / rect.height,
      width: box.width / rect.width,
      height: box.height / rect.height,
    });
  }

  /**
   * Captures the page (or an area of it, as fractions) at the Screenshot
   * tool's chosen scale, then copies it to the clipboard (reporting through
   * the screenshot toast) or downloads it straight away.
   */
  function capturePageImage(area: Parameters<typeof capturePage>[3], destination: 'clipboard' | 'download') {
    const doc = $activeDocument;
    if (!doc || !pdfDoc || capturing) return;

    const baseName = doc.file.name.replace(/\.pdf$/i, '');
    const fileName = `${baseName}_page${pageNumber}${area ? '_area' : ''}.png`;

    capturing = true;
    const png = $screenshotIncludeEdits
      ? captureWithEdits(pdfDoc, doc, area)
      : capturePage(pdfDoc, pageNumber, doc.rotation, area, null, $screenshotScale);
    if (destination === 'download') {
      png
        .then((blob) => {
          downloadBlob(blob, fileName);
          screenshotResult.set(null);
        })
        .catch((err) =>
          screenshotResult.set({
            ok: false,
            message: err instanceof Error ? err.message : 'Failed to take the screenshot',
          }),
        )
        .finally(() => (capturing = false));
      return;
    }
    // Started synchronously, while the click still counts as a user gesture.
    const copied = copyImageToClipboard(png);
    Promise.all([png, copied])
      .then(([blob, ok]) => screenshotResult.set({ ok: true, blob, fileName, copied: ok }))
      .catch((err) =>
        screenshotResult.set({
          ok: false,
          message: err instanceof Error ? err.message : 'Failed to take the screenshot',
        }),
      )
      .finally(() => (capturing = false));
  }

  // Captures include what's been placed on the page, drawn the way export
  // will: the signature with its watermark, text, redactions, and form values.
  async function captureWithEdits(
    loaded: PdfDocument,
    doc: NonNullable<typeof $activeDocument>,
    area: Parameters<typeof capturePage>[3],
  ): Promise<Blob> {
    // Each placement's own signature, watermarked once per distinct image.
    const watermarked = new Map<Blob, Promise<Blob>>();
    const signatures = (
      await Promise.all(
        signaturesOnCurrentPage.map(async (placement) => {
          const blob = resolveSignature($signatureStore, placement.signatureId)?.blob;
          if (!blob) return null;
          if (!watermarked.has(blob)) watermarked.set(blob, applyVisibleWatermark(blob, currentWatermarkOptions()));
          return { ...placement, image: await watermarked.get(blob)! };
        }),
      )
    ).filter((s) => s !== null);
    const overlays: CaptureOverlays = {
      renderScale: $editorStore.renderScale,
      fields: formBoxes.map((f) => {
        const value = widgetValue(f, formValues);
        const shown =
          f.kind === 'radio'
            ? value === f.onValue
            : f.kind === 'select'
              ? (f.options.find((o) => o.value === value)?.label ?? value)
              : value;
        return {
          kind: f.kind,
          value: shown,
          multiLine: f.multiLine,
          fontSize: f.fontPx,
          align: f.align,
          x: f.left,
          y: f.top,
          width: f.boxWidth,
          height: f.boxHeight,
        };
      }),
      markups: highlightsOnCurrentPage.map((h) => markupPaint(h, pageRotation)),
      redactions: redactionsOnCurrentPage,
      signatures,
      texts: textsOnCurrentPage,
      shapes: shapesOnCurrentPage,
      images: imagesOnCurrentPage.flatMap((img) => {
        const stored = imageFor(img.imageId);
        return stored ? [{ ...img, image: stored.blob }] : [];
      }),
      labels: edgeLabels,
      watermark: watermark ? { settings: watermark, image: watermarkImage } : null,
    };
    return capturePage(loaded, pageNumber, doc.rotation, area, overlays, $screenshotScale);
  }

  // Move an existing box. Looks the box up fresh by id on every step (rather
  // than trusting a closure snapshot) since editorStore emits a new object on
  // every pointermove, same reasoning as the signature's move handler above.
  let movingRedactionId: string | null = null;
  let redactMoveOffset = { x: 0, y: 0 };

  function onRedactionPointerDown(e: PointerEvent, id: string) {
    e.stopPropagation();
    selectedRedactionId = id;
    movingRedactionId = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const boxRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    redactMoveOffset = { x: e.clientX - boxRect.left, y: e.clientY - boxRect.top };
  }

  function onRedactionPointerMove(e: PointerEvent, id: string) {
    if (movingRedactionId !== id) return;
    const box = $activeDocument?.redactions.find((b) => b.id === id);
    if (!box) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left - redactMoveOffset.x, 0, rect.width - box.width);
    const y = clamp(e.clientY - rect.top - redactMoveOffset.y, 0, rect.height - box.height);
    editorStore.updateRedaction(id, { x, y });
  }

  function onRedactionPointerUp() {
    movingRedactionId = null;
  }

  // Resize via the corner handle — a redaction box is a plain rectangle, so
  // unlike the signature's resize this doesn't need to preserve an aspect ratio.
  const REDACT_MIN_SIZE = 12;
  let resizingRedactionId: string | null = null;
  let redactResizeStart: (RedactionBox & { pointerX: number; pointerY: number }) | null = null;

  function onRedactionResizePointerDown(e: PointerEvent, id: string) {
    e.stopPropagation();
    const box = $activeDocument?.redactions.find((b) => b.id === id);
    if (!box) return;
    resizingRedactionId = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    redactResizeStart = { pointerX: e.clientX, pointerY: e.clientY, ...box };
  }

  function onRedactionResizePointerMove(e: PointerEvent, id: string) {
    if (resizingRedactionId !== id || !redactResizeStart) return;
    const rect = canvasEl.getBoundingClientRect();
    const width = clamp(
      redactResizeStart.width + (e.clientX - redactResizeStart.pointerX),
      REDACT_MIN_SIZE,
      rect.width - redactResizeStart.x,
    );
    const height = clamp(
      redactResizeStart.height + (e.clientY - redactResizeStart.pointerY),
      REDACT_MIN_SIZE,
      rect.height - redactResizeStart.y,
    );
    editorStore.updateRedaction(id, { width, height });
  }

  function onRedactionResizePointerUp(e: PointerEvent) {
    resizingRedactionId = null;
    redactResizeStart = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function removeRedactionBox(e: MouseEvent, id: string) {
    e.stopPropagation();
    editorStore.removeRedaction(id);
    if (selectedRedactionId === id) selectedRedactionId = null;
  }

  function onRedactionKeydown(e: KeyboardEvent, id: string) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      editorStore.removeRedaction(id);
      selectedRedactionId = null;
      return;
    }

    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) return;
    e.preventDefault();

    const box = $activeDocument?.redactions.find((b) => b.id === id);
    if (!box) return;

    const rect = canvasEl.getBoundingClientRect();
    const dx = e.key === 'ArrowLeft' ? -KEYBOARD_MOVE_STEP : e.key === 'ArrowRight' ? KEYBOARD_MOVE_STEP : 0;
    const dy = e.key === 'ArrowUp' ? -KEYBOARD_MOVE_STEP : e.key === 'ArrowDown' ? KEYBOARD_MOVE_STEP : 0;
    const x = clamp(box.x + dx, 0, rect.width - box.width);
    const y = clamp(box.y + dy, 0, rect.height - box.height);
    editorStore.updateRedaction(id, { x, y });
  }

  // Text tool: click to drop a text box (in textToolMode), then type directly
  // into it. Move/resize mirror the redaction box (a plain rectangle, no
  // aspect-ratio lock) rather than the signature.
  const TEXT_DEFAULT_WIDTH = 220;
  const TEXT_MIN_WIDTH = 40;
  const TEXT_MIN_HEIGHT = 20;

  let editingTextId: string | null = $state(null);
  let textEditValue = $state('');

  function autofocusTextarea(node: HTMLTextAreaElement) {
    node.focus();
    node.select();
  }

  function startEditingText(id: string, initialValue: string) {
    editingTextId = id;
    textEditValue = initialValue;
  }

  // `forId`, when given, is the id the caller believes it's committing (e.g.
  // a textarea's own onblur). When Svelte unmounts a text box that just
  // stopped being edited (its {#if isEditing} branch switching off), removing
  // that DOM node from the document fires a genuine native 'blur' on it —
  // but by then editingTextId may have already moved on to a *different* box
  // the user clicked to create next. Without this guard, that stale blur
  // would call commitTextEdit() and it'd blindly act on whatever
  // editingTextId is *now*, wiping out the new box instead of the old one.
  function commitTextEdit(forId?: string) {
    if (forId !== undefined && forId !== editingTextId) return;
    if (!editingTextId) return;
    const id = editingTextId;
    const value = textEditValue;
    editingTextId = null;
    // An empty box left after editing is just clutter — drop it rather than
    // leaving an invisible placeholder on the page.
    if (!value.trim()) editorStore.removeText(id);
    else editorStore.updateText(id, { text: value });
  }

  function addTextAt(e: ClientPoint) {
    const doc = $activeDocument;
    if (!doc) return;

    const rect = canvasEl.getBoundingClientRect();
    const width = Math.min(TEXT_DEFAULT_WIDTH, rect.width);
    const height = $defaultTextFontSize * Math.max(1.6, $defaultTextLineHeight + 0.4);
    // The click point becomes the box's left-center, not its center — text
    // starts growing to the right from where the user clicked, matching how
    // a cursor placement works in most text editors.
    const x = clamp(e.clientX - rect.left, 0, rect.width - width);
    const y = clamp(e.clientY - rect.top - height / 2, 0, rect.height - height);

    const id = editorStore.addText({
      x,
      y,
      width,
      height,
      page: pageNumber,
      text: '',
      fontFamily: $defaultTextFontFamily,
      fontSize: $defaultTextFontSize,
      bold: $defaultTextBold,
      italic: $defaultTextItalic,
      underline: $defaultTextUnderline,
      color: $defaultTextColor,
      letterSpacing: $defaultTextLetterSpacing,
      align: $defaultTextAlign,
      strikethrough: $defaultTextStrikethrough,
      background: $defaultTextBackground,
      opacity: $defaultTextOpacity,
      wordSpacing: $defaultTextWordSpacing,
      lineHeight: $defaultTextLineHeight,
      script: $defaultTextScript,
    });
    $selectedTextId = id;
    startEditingText(id, '');
  }

  function onTextDoubleClick(e: MouseEvent, t: PlacedText) {
    e.stopPropagation();
    $selectedTextId = t.id;
    startEditingText(t.id, t.text);
  }

  let movingTextId: string | null = null;
  let textMoveOffset = { x: 0, y: 0 };

  function onTextPointerDown(e: PointerEvent, id: string) {
    if (editingTextId === id) return;
    e.stopPropagation();
    $selectedTextId = id;
    movingTextId = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const boxRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    textMoveOffset = { x: e.clientX - boxRect.left, y: e.clientY - boxRect.top };
  }

  function onTextPointerMove(e: PointerEvent, id: string) {
    if (movingTextId !== id) return;
    const t = $activeDocument?.texts.find((x) => x.id === id);
    if (!t) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left - textMoveOffset.x, 0, rect.width - t.width);
    const y = clamp(e.clientY - rect.top - textMoveOffset.y, 0, rect.height - t.height);
    editorStore.updateText(id, { x, y });
  }

  function onTextPointerUp() {
    movingTextId = null;
  }

  function onTextKeydown(e: KeyboardEvent, id: string) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      editorStore.removeText(id);
      if ($selectedTextId === id) $selectedTextId = null;
      return;
    }

    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) return;
    e.preventDefault();

    const t = $activeDocument?.texts.find((x) => x.id === id);
    if (!t) return;

    const rect = canvasEl.getBoundingClientRect();
    const dx = e.key === 'ArrowLeft' ? -KEYBOARD_MOVE_STEP : e.key === 'ArrowRight' ? KEYBOARD_MOVE_STEP : 0;
    const dy = e.key === 'ArrowUp' ? -KEYBOARD_MOVE_STEP : e.key === 'ArrowDown' ? KEYBOARD_MOVE_STEP : 0;
    const x = clamp(t.x + dx, 0, rect.width - t.width);
    const y = clamp(t.y + dy, 0, rect.height - t.height);
    editorStore.updateText(id, { x, y });
  }

  let resizingTextId: string | null = null;
  let textResizeStart: (PlacedText & { pointerX: number; pointerY: number }) | null = null;

  function onTextResizePointerDown(e: PointerEvent, id: string) {
    e.stopPropagation();
    const t = $activeDocument?.texts.find((x) => x.id === id);
    if (!t) return;
    resizingTextId = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    textResizeStart = { pointerX: e.clientX, pointerY: e.clientY, ...t };
  }

  function onTextResizePointerMove(e: PointerEvent, id: string) {
    if (resizingTextId !== id || !textResizeStart) return;
    const rect = canvasEl.getBoundingClientRect();
    const width = clamp(
      textResizeStart.width + (e.clientX - textResizeStart.pointerX),
      TEXT_MIN_WIDTH,
      rect.width - textResizeStart.x,
    );
    const height = clamp(
      textResizeStart.height + (e.clientY - textResizeStart.pointerY),
      TEXT_MIN_HEIGHT,
      rect.height - textResizeStart.y,
    );
    editorStore.updateText(id, { width, height });
  }

  function onTextResizePointerUp(e: PointerEvent) {
    resizingTextId = null;
    textResizeStart = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function removeText(e: MouseEvent, id: string) {
    e.stopPropagation();
    editorStore.removeText(id);
    if ($selectedTextId === id) $selectedTextId = null;
  }

  // Comment tool: click to drop a fixed-size sticky-note marker (in
  // commentToolMode), then type its note. Move mirrors the signature/text
  // overlays (plain pointerdown/move/up, no resize — the marker is always
  // the same size); editing opens a floating note panel rather than turning
  // the marker itself into a textarea, since the marker is too small to type into.
  const COMMENT_SIZE = 26;

  let selectedCommentId: string | null = $state(null);
  let editingCommentId: string | null = $state(null);
  let commentEditValue = $state('');
  // A comment on selected text that hasn't been written yet: left empty, its
  // highlight goes too, since both came from the same button.
  let newTextCommentId: string | null = null;
  const selectedCommentGroup = $derived(
    selectedCommentId ? ($activeDocument?.comments.find((c) => c.id === selectedCommentId)?.groupId ?? null) : null,
  );

  function autofocusNote(node: HTMLTextAreaElement) {
    node.focus();
  }

  function startEditingComment(id: string, initialValue: string) {
    editingCommentId = id;
    commentEditValue = initialValue;
  }

  // `forId` guards against a stale blur firing after editingCommentId has
  // already moved on to a different marker — same race as commitTextEdit above.
  function commitCommentEdit(forId?: string) {
    if (forId !== undefined && forId !== editingCommentId) return;
    if (!editingCommentId) return;
    const id = editingCommentId;
    const value = commentEditValue;
    editingCommentId = null;
    const isNewTextComment = newTextCommentId === id;
    newTextCommentId = null;
    // An empty note is just clutter — drop it rather than leaving a blank marker.
    if (!value.trim()) {
      const groupId = $activeDocument?.comments.find((c) => c.id === id)?.groupId;
      if (isNewTextComment && groupId) removeHighlight(groupId);
      else editorStore.removeComment(id);
      if (selectedCommentId === id) selectedCommentId = null;
    } else {
      editorStore.updateComment(id, { text: value });
    }
  }

  function addCommentAt(e: ClientPoint) {
    const doc = $activeDocument;
    if (!doc) return;

    const rect = canvasEl.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left - COMMENT_SIZE / 2, 0, rect.width - COMMENT_SIZE);
    const y = clamp(e.clientY - rect.top - COMMENT_SIZE / 2, 0, rect.height - COMMENT_SIZE);

    const id = editorStore.addComment({
      x,
      y,
      width: COMMENT_SIZE,
      height: COMMENT_SIZE,
      page: pageNumber,
      text: '',
    });
    selectedCommentId = id;
    startEditingComment(id, '');
  }

  let movingCommentId: string | null = null;
  let commentMoveOffset = { x: 0, y: 0 };

  function onCommentPointerDown(e: PointerEvent, id: string) {
    if (editingCommentId === id) return;
    e.stopPropagation();
    selectedCommentId = id;
    movingCommentId = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const markerRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    commentMoveOffset = { x: e.clientX - markerRect.left, y: e.clientY - markerRect.top };
  }

  function onCommentPointerMove(e: PointerEvent, id: string) {
    if (movingCommentId !== id) return;
    const c = $activeDocument?.comments.find((x) => x.id === id);
    if (!c) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left - commentMoveOffset.x, 0, rect.width - c.width);
    const y = clamp(e.clientY - rect.top - commentMoveOffset.y, 0, rect.height - c.height);
    editorStore.updateComment(id, { x, y });
  }

  function onCommentPointerUp() {
    movingCommentId = null;
  }

  function onCommentDoubleClick(e: MouseEvent, c: PlacedComment) {
    e.stopPropagation();
    selectedCommentId = c.id;
    startEditingComment(c.id, c.text);
  }

  function onCommentKeydown(e: KeyboardEvent, id: string) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      editorStore.removeComment(id);
      if (selectedCommentId === id) selectedCommentId = null;
      return;
    }

    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) return;
    e.preventDefault();

    const c = $activeDocument?.comments.find((x) => x.id === id);
    if (!c) return;

    const rect = canvasEl.getBoundingClientRect();
    const dx = e.key === 'ArrowLeft' ? -KEYBOARD_MOVE_STEP : e.key === 'ArrowRight' ? KEYBOARD_MOVE_STEP : 0;
    const dy = e.key === 'ArrowUp' ? -KEYBOARD_MOVE_STEP : e.key === 'ArrowDown' ? KEYBOARD_MOVE_STEP : 0;
    const x = clamp(c.x + dx, 0, rect.width - c.width);
    const y = clamp(c.y + dy, 0, rect.height - c.height);
    editorStore.updateComment(id, { x, y });
  }

  function removeComment(e: MouseEvent, id: string) {
    e.stopPropagation();
    editorStore.removeComment(id);
    if (selectedCommentId === id) selectedCommentId = null;
  }

  // Right-click menu on the document. What's under the pointer decides the
  // items: a placed object gets its own actions, selected text gets Copy and
  // Highlight, and the page itself gets placement, zoom, rotate, and capture.
  let menu: { x: number; y: number; items: ContextMenuItem[] } | null = $state(null);
  // Bumped by every pointerdown, so a page menu still waiting on the page's
  // pictures doesn't open after the user has moved on.
  let menuToken = 0;

  function onDocumentContextMenu(e: MouseEvent) {
    const target = e.target as HTMLElement;
    // Text fields keep the browser's own menu (spelling, paste, …).
    if (target.closest('input, textarea, select')) return;
    e.preventDefault();
    // Screenshot and area recognition own every click on the page.
    if ($screenshotToolMode || $ocrAreaMode) return;
    const doc = $activeDocument;
    if (!doc) return;
    const items = menuItemsFor(e, target, doc);
    if (items) {
      if (items.length > 0) menu = { x: e.clientX, y: e.clientY, items };
      return;
    }

    // The page itself: a picture of the PDF's own under the pointer adds
    // Save image and Copy image above the page's actions.
    const point: ClientPoint = { clientX: e.clientX, clientY: e.clientY };
    const rect = canvasEl.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const token = ++menuToken;
    loadPageImages()
      .then((found) => {
        const image = imageAt(found.images, fx * found.width, fy * found.height);
        return image ? { ...found, image } : null;
      })
      .catch(() => null)
      .then((hit) => {
        if (token !== menuToken) return;
        const pageItems = pageMenuItems(point);
        if (!hit) {
          menu = { x: point.clientX, y: point.clientY, items: pageItems };
          return;
        }
        pageItems[0] = { ...pageItems[0], separatorBefore: true };
        menu = { x: point.clientX, y: point.clientY, items: [...imageMenuItems(doc.file, hit), ...pageItems] };
      });
  }

  // The PDF's own pictures on this page (lib/pdf/embeddedImages.ts), read on
  // the first right-click rather than alongside every render.
  type FoundImages = { page: PDFPageProxy; images: PaintedImage[]; width: number; height: number };
  let pageImagesCache: { doc: PdfDocument; page: number; rotation: number; found: Promise<FoundImages> } | null = null;

  function loadPageImages(): Promise<FoundImages> {
    const doc = pdfDoc;
    const page = pageNumber;
    const rotation = viewRotation;
    const cached = pageImagesCache;
    if (cached && cached.doc === doc && cached.page === page && cached.rotation === rotation) return cached.found;
    const found = doc.getPage(page).then(async (p) => {
      const total = getTotalRotation(p, rotation);
      const { width, height } = p.getViewport({ scale: 1, rotation: total });
      return { page: p, images: await pageImages(p, total), width, height };
    });
    pageImagesCache = { doc, page, rotation, found };
    return found;
  }

  function imageMenuItems(file: File, hit: FoundImages & { image: PaintedImage }): ContextMenuItem[] {
    const failed = (err: unknown) =>
      screenshotResult.set({ ok: false, message: err instanceof Error ? err.message : 'Failed to save the image' });
    return [
      {
        label: 'Save image',
        icon: MENU_ICONS.save,
        onSelect: () => downloadImage(file, hit.page, hit.images, hit.image).catch(failed),
      },
      {
        label: 'Copy image',
        icon: MENU_ICONS.copy,
        onSelect: () => {
          const png = imagePng(hit.page, hit.image);
          // Started synchronously, while the click still counts as a user gesture.
          const copied = copyImageToClipboard(png);
          const fileName = `${file.name.replace(/\.pdf$/i, '')}_page${hit.page.pageNumber}_image.png`;
          Promise.all([png, copied])
            .then(([blob, ok]) => screenshotResult.set({ ok: true, blob, fileName, copied: ok, label: 'Image' }))
            .catch(failed);
        },
      },
    ];
  }

  function highlightAt(point: ClientPoint) {
    const rect = canvasEl.getBoundingClientRect();
    const x = point.clientX - rect.left;
    const y = point.clientY - rect.top;
    return highlightsOnCurrentPage.find((h) => x >= h.x && x <= h.x + h.width && y >= h.y && y <= h.y + h.height);
  }

  function menuItemsFor(
    e: MouseEvent,
    target: HTMLElement,
    doc: NonNullable<typeof $activeDocument>,
  ): ContextMenuItem[] | null {
    const idOf = (attr: string) => target.closest(`[${attr}]`)?.getAttribute(attr) ?? null;
    const deleteItem = (label: string, remove: () => void): ContextMenuItem => ({
      label,
      icon: MENU_ICONS.delete,
      hint: 'Del',
      danger: true,
      onSelect: remove,
    });

    const shapeId = idOf('data-placed-shape');
    const shape = shapeId ? doc.shapes.find((s) => s.id === shapeId) : undefined;
    if (shape) {
      $selectedShapeId = shape.id;
      return [
        deleteItem(`Delete ${SHAPE_LABELS[shape.kind].toLowerCase()}`, () => {
          editorStore.removeShape(shape.id);
          $selectedShapeId = null;
        }),
      ];
    }

    const placedImageId = idOf('data-placed-image');
    if (placedImageId) {
      selectedImageId = placedImageId;
      return [
        deleteItem('Delete image', () => {
          editorStore.removeImage(placedImageId);
          selectedImageId = null;
        }),
      ];
    }

    const signatureId = idOf('data-placed-signature');
    if (signatureId) {
      selectedSignatureId = signatureId;
      const angle = doc.placedSignatures.find((s) => s.id === signatureId)?.angle ?? 0;
      return [
        { label: 'Edit signature', icon: MENU_ICONS.edit, onSelect: () => editSignature(signatureId) },
        {
          label: 'Rotate left',
          icon: MENU_ICONS.rotateLeft,
          separatorBefore: true,
          onSelect: () => rotateSignatureBy(signatureId, -90),
        },
        { label: 'Rotate right', icon: MENU_ICONS.rotateRight, onSelect: () => rotateSignatureBy(signatureId, 90) },
        {
          label: 'Straighten',
          icon: MENU_ICONS.signature,
          disabled: angle === 0,
          onSelect: () => rotateSignatureBy(signatureId, -angle),
        },
        {
          ...deleteItem('Delete signature', () => {
            editorStore.removeSignature(signatureId);
            selectedSignatureId = null;
          }),
          separatorBefore: true,
        },
      ];
    }

    const redactionId = idOf('data-redaction');
    if (redactionId) {
      selectedRedactionId = redactionId;
      return [
        deleteItem('Delete redaction', () => {
          editorStore.removeRedaction(redactionId);
          selectedRedactionId = null;
        }),
      ];
    }

    const textId = idOf('data-placed-text');
    const text = textId ? doc.texts.find((t) => t.id === textId) : undefined;
    if (text) {
      $selectedTextId = text.id;
      return [
        {
          label: 'Edit text',
          icon: MENU_ICONS.edit,
          onSelect: () => {
            $selectedTextId = text.id;
            startEditingText(text.id, text.text);
          },
        },
        deleteItem('Delete text', () => {
          editorStore.removeText(text.id);
          $selectedTextId = null;
        }),
      ];
    }

    const commentId = idOf('data-placed-comment');
    const comment = commentId ? doc.comments.find((c) => c.id === commentId) : undefined;
    if (comment) {
      selectedCommentId = comment.id;
      return [
        {
          label: 'Edit comment',
          icon: MENU_ICONS.edit,
          onSelect: () => {
            selectedCommentId = comment.id;
            startEditingComment(comment.id, comment.text);
          },
        },
        deleteItem('Delete comment', () => {
          editorStore.removeComment(comment.id);
          selectedCommentId = null;
        }),
      ];
    }

    // Read now: clicking a menu item clears the page's text selection.
    const selectedText = hasTextSelection ? (window.getSelection()?.toString() ?? '') : '';
    if (selectedText.trim()) {
      updatePendingHighlight();
      const boxes = pendingHighlight?.boxes ?? [];
      return [
        {
          label: 'Copy',
          icon: MENU_ICONS.copy,
          hint: 'Ctrl+C',
          onSelect: () => navigator.clipboard.writeText(selectedText).catch(() => {}),
        },
        ...(['highlight', 'underline', 'strikeout'] as const).map((kind, i) => ({
          label: MARKUP_LABELS[kind],
          icon: MENU_ICONS[kind],
          separatorBefore: i === 0,
          disabled: boxes.length === 0,
          onSelect: () => addMarkup(boxes, kind),
        })),
        {
          label: 'Comment',
          icon: MENU_ICONS.comment,
          disabled: boxes.length === 0,
          onSelect: () => commentOnText(boxes),
        },
      ];
    }

    const point: ClientPoint = { clientX: e.clientX, clientY: e.clientY };

    const groupId = idOf('data-highlight-group') ?? highlightAt(point)?.groupId;
    const markup = groupId ? doc.highlights.find((h) => h.groupId === groupId) : undefined;
    if (groupId && markup) {
      selectedHighlightGroup = groupId;
      const note = {
        label: doc.comments.some((c) => c.groupId === groupId) ? 'Edit comment' : 'Add comment',
        icon: MENU_ICONS.comment,
        onSelect: () => commentOnMarkup(groupId),
      };
      // Only highlights can be recolored; lines are always black.
      const remove = deleteItem(`Remove ${MARKUP_LABELS[markup.kind].toLowerCase()}`, () => removeHighlight(groupId));
      if (markup.kind !== 'highlight') return [note, { ...remove, separatorBefore: true }];
      return [
        ...MARKUP_COLORS.map((c) => ({
          label: c.label,
          swatch: c.value,
          disabled: markup.color === c.value,
          onSelect: () => editorStore.recolorHighlight(groupId, c.value),
        })),
        { ...note, separatorBefore: true },
        { ...remove, separatorBefore: true },
      ];
    }

    // Nothing placed under the pointer: the page menu (onDocumentContextMenu).
    return null;
  }

  function pageMenuItems(point: ClientPoint): ContextMenuItem[] {
    const page = pageNumber;
    return [
      {
        label: 'Place signature here',
        icon: MENU_ICONS.signature,
        disabled: !$signatureStore.signature,
        onSelect: () => placeSignatureAt(point),
      },
      {
        label: 'Add text here',
        icon: MENU_ICONS.text,
        onSelect: () => {
          if (editingTextId) commitTextEdit();
          addTextAt(point);
        },
      },
      {
        label: 'Add comment here',
        icon: MENU_ICONS.comment,
        onSelect: () => {
          if (editingCommentId) commitCommentEdit();
          addCommentAt(point);
        },
      },
      {
        label: 'Add image here',
        icon: MENU_ICONS.image,
        onSelect: () => {
          imageMenuPoint = point;
          imageInputEl?.click();
        },
      },
      { label: 'Zoom in', icon: MENU_ICONS.zoomIn, separatorBefore: true, onSelect: editorStore.zoomIn },
      { label: 'Zoom out', icon: MENU_ICONS.zoomOut, onSelect: editorStore.zoomOut },
      {
        label: 'Rotate page left',
        icon: MENU_ICONS.rotateLeft,
        separatorBefore: true,
        onSelect: () => editorStore.rotatePage(page, -90).catch(() => {}),
      },
      {
        label: 'Rotate page right',
        icon: MENU_ICONS.rotateRight,
        onSelect: () => editorStore.rotatePage(page, 90).catch(() => {}),
      },
      {
        label: 'Copy page as image',
        icon: MENU_ICONS.camera,
        separatorBefore: true,
        disabled: capturing,
        onSelect: () => capturePageImage(null, 'clipboard'),
      },
      {
        label: 'Recognize text on this page',
        icon: MENU_ICONS.recognize,
        disabled: isOcrRunning($ocrStatus),
        onSelect: () => recognizeText([page]),
      },
      {
        label: 'Recognize text in an area',
        icon: MENU_ICONS.recognizeArea,
        disabled: isOcrRunning($ocrStatus),
        onSelect: startAreaSelection,
      },
    ];
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div
  bind:this={wrapperEl}
  role="region"
  aria-label="Page {pageNumber}. Drop the signature here."
  class="relative mx-auto w-fit"
  class:ring-2={isDragOver}
  class:ring-blue-400={isDragOver}
  ondragover={onDragOver}
  ondragleave={() => (isDragOver = false)}
  ondrop={onDrop}
  onpointerdown={onWrapperPointerDown}
  onpointermove={onWrapperPointerMove}
  onpointerup={onWrapperPointerUp}
  onpointerleave={onWrapperPointerLeave}
  oncontextmenu={onDocumentContextMenu}
>
  <canvas
    bind:this={canvasEl}
    class="rounded-lg shadow-lg active:cursor-grabbing"
    class:cursor-crosshair={$redactMode || $shapeToolMode}
    class:cursor-text={($textToolMode || $commentToolMode) && !$redactMode}
    class:cursor-grab={!$redactMode &&
      !$textToolMode &&
      !$commentToolMode &&
      !$clickToPlaceMode &&
      !$shapeToolMode &&
      !textSelectActive}
    onpointerdown={onCanvasClick}
    onpointermove={onCanvasMouseMove}
  ></canvas>

  <!-- Invisible, selectable text built by lib/pdf/textLayer.ts — always
       built (see the $effect above) so hover hit-testing has real geometry
       to check, but only receives pointer events while textSelectActive
       (the manual Select toggle, or a live hover-trigger) is true, so it
       never steals clicks/drags meant for the canvas or the other overlays
       below in every other mode. -->
  <div bind:this={textLayerEl} class="pdf-text-layer" class:pointer-events-none={!textSelectActive}></div>

  <!-- Watermark preview: lib/pdf/pageWatermark.ts draws the same on export,
       each stamp turned around its centre. -->
  {#if watermark && watermarkStamps.length > 0}
    {@const unit = $editorStore.renderScale}
    <div class="pointer-events-none absolute inset-0 select-none overflow-hidden rounded-lg" aria-hidden="true">
      {#each watermarkStamps as stamp}
        {#if watermarkImage}
          <img
            src={watermarkImage.url}
            alt=""
            class="absolute max-w-none"
            style:left="{stamp.x * unit}px"
            style:top="{stamp.y * unit}px"
            style:width="{stamp.width * unit}px"
            style:height="{stamp.height * unit}px"
            style:opacity={watermark.opacity}
            style:transform="translate(-50%, -50%) rotate({-watermark.angle}deg)"
          />
        {:else}
          <div
            class="absolute whitespace-nowrap leading-none"
            style:left="{stamp.x * unit}px"
            style:top="{stamp.y * unit}px"
            style:font-family={FONT_FAMILY_CSS[watermark.font]}
            style:font-weight={watermark.bold ? 700 : 400}
            style:font-size="{watermark.fontSize * unit}px"
            style:color={watermark.color}
            style:opacity={watermark.opacity}
            style:transform="translate(-50%, -50%) rotate({-watermark.angle}deg)"
          >
            {watermark.text.trim()}
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  <!-- Page number, header, and footer preview: lib/pdf/pageNumbers.ts draws
       the same on export. With line-height 1 the baseline sits about 0.85em
       below the box top. -->
  {#each edgeLabels as s}
    {@const unit = $editorStore.renderScale}
    {@const [vertical, horizontal] = s.position.split('-')}
    <div
      class="pointer-events-none absolute select-none whitespace-nowrap leading-none"
      style:font-family={FONT_FAMILY_CSS[s.font]}
      style:font-size="{s.fontSize * unit}px"
      style:color={s.color}
      style:left={horizontal === 'left' ? `${s.margin * unit}px` : horizontal === 'center' ? '50%' : null}
      style:right={horizontal === 'right' ? `${s.margin * unit}px` : null}
      style:transform={horizontal === 'center' ? 'translateX(-50%)' : null}
      style:top={vertical === 'top' ? `${(s.margin - 0.13 * s.fontSize) * unit}px` : null}
      style:bottom={vertical === 'bottom' ? `${(s.margin - 0.15 * s.fontSize) * unit}px` : null}
    >
      {s.text}
    </div>
  {/each}

  <!-- Search matches: drawn under everything else and never take clicks. -->
  {#each searchHits as hit}
    {#each hit.boxes as box, i}
      <div
        data-search-current={hit.current && i === 0 ? '' : undefined}
        class="pointer-events-none absolute rounded-sm mix-blend-multiply {hit.current
          ? 'bg-orange-400/80 outline outline-2 outline-orange-500'
          : 'bg-amber-300/50'}"
        style:left="{box.x - 1}px"
        style:top="{box.y - 1}px"
        style:width="{box.width + 2}px"
        style:height="{box.height + 2}px"
      ></div>
    {/each}
  {/each}

  <!-- Markups sit above the text layer so they can be clicked (then
       recolored or removed) in Move mode; in every other mode they let clicks
       through, so the Select tool can still select marked-up text. The
       clickable box is the whole marked text; only the paint inside differs
       by kind — the full box for a highlight, a thin line for the others. -->
  {#each highlightsOnCurrentPage as h, i (h.id)}
    {@const isSelected = selectedHighlightGroup === h.groupId || selectedCommentGroup === h.groupId}
    {@const isFirstOfGroup = highlightsOnCurrentPage.findIndex((x) => x.groupId === h.groupId) === i}
    {@const paint = markupPaint(h, pageRotation)}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      data-highlight-group={h.groupId}
      role="group"
      tabindex={isFirstOfGroup ? 0 : -1}
      aria-label="{MARKUP_LABELS[h.kind]}. Press Delete to remove."
      class="absolute cursor-pointer {isSelected ? 'outline outline-2 outline-blue-400' : ''}"
      class:pointer-events-none={!formFieldsInteractive}
      style:left="{h.x}px"
      style:top="{h.y}px"
      style:width="{h.width}px"
      style:height="{h.height}px"
      onpointerdown={(e) => {
        e.stopPropagation();
        selectedHighlightGroup = h.groupId;
      }}
      onfocus={() => (selectedHighlightGroup = h.groupId)}
      onkeydown={(e) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        e.preventDefault();
        removeHighlight(h.groupId);
      }}
    >
      <div
        class="pointer-events-none absolute"
        class:mix-blend-multiply={paint.multiply}
        style:left="{paint.x - h.x}px"
        style:top="{paint.y - h.y}px"
        style:width="{paint.width}px"
        style:height="{paint.height}px"
        style:background-color={paint.color}
      ></div>
    </div>
  {/each}

  <!-- The selected markup's own toolbar: recolor or remove. Kept outside the
       markup boxes, whose multiplied paint would tint anything inside them. -->
  {#each highlightsOnCurrentPage.filter((h) => h.groupId === selectedHighlightGroup).slice(0, 1) as h (h.id)}
    {@const hasNote = commentsOnCurrentPage.some((c) => c.groupId === h.groupId)}
    <div
      data-highlight-group={h.groupId}
      role="toolbar"
      aria-label="{MARKUP_LABELS[h.kind]} options"
      tabindex="-1"
      class="absolute z-40 flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-1.5 py-1
        shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      style:left="{h.x}px"
      style:top={h.y < 40 ? `${h.y + h.height + 6}px` : `${h.y - 34}px`}
      onpointerdown={(e) => e.stopPropagation()}
    >
      {#if h.kind === 'highlight'}
        {#each MARKUP_COLORS as c}
          <button
            type="button"
            aria-label="{c.label}"
            aria-pressed={h.color === c.value}
            use:tooltip={c.label}
            class="h-4 w-4 rounded-full border transition-transform hover:scale-110 {h.color === c.value
              ? 'border-neutral-700 ring-2 ring-blue-400/50 dark:border-white'
              : 'border-black/10 dark:border-white/20'}"
            style:background-color={c.value}
            onclick={() => editorStore.recolorHighlight(h.groupId, c.value)}
          ></button>
        {/each}
        <span class="mx-0.5 h-4 w-px bg-neutral-200 dark:bg-neutral-700"></span>
      {/if}
      <button
        type="button"
        aria-label={hasNote ? 'Edit comment' : 'Add comment'}
        use:tooltip={hasNote ? 'Edit comment' : 'Add a comment to this text'}
        class="flex h-5 w-5 items-center justify-center rounded-full text-neutral-500 transition-colors
          hover:bg-amber-50 hover:text-amber-700 dark:text-neutral-400 dark:hover:bg-amber-950 dark:hover:text-amber-300"
        onclick={() => commentOnMarkup(h.groupId)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
          <path stroke-linecap="round" stroke-linejoin="round" d={MENU_ICONS.comment} />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Remove {MARKUP_LABELS[h.kind].toLowerCase()}"
        use:tooltip={`Remove ${MARKUP_LABELS[h.kind].toLowerCase()} (Delete)`}
        class="flex h-5 w-5 items-center justify-center rounded-full text-neutral-500 transition-colors
          hover:bg-red-50 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-950"
        onclick={() => removeHighlight(h.groupId)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
          <path stroke-linecap="round" stroke-linejoin="round" d={MENU_ICONS.delete} />
        </svg>
      </button>
    </div>
  {/each}

  <!-- The PDF's own form fields. The layer itself never takes clicks, only
       the inputs do, and only in Move mode (see formFieldsInteractive). -->
  {#if formBoxes.length > 0}
    <div class="pointer-events-none absolute inset-0">
      {#each formBoxes as f (f.id)}
        {@const value = widgetValue(f, formValues)}
        {@const fieldClass = `absolute m-0 rounded-sm border border-blue-400/50 bg-blue-100/40 text-black outline-none
          focus:border-blue-500 focus:bg-white/90 disabled:cursor-not-allowed disabled:bg-transparent
          ${formFieldsInteractive ? 'pointer-events-auto' : ''}`}
        {@const position = `left:${f.left}px;top:${f.top}px;width:${f.boxWidth}px;height:${f.boxHeight}px;`}
        {#if f.kind === 'text' && f.multiLine}
          <textarea
            aria-label={f.fieldName}
            class="{fieldClass} resize-none p-0.5 leading-tight"
            style="{position}font-size:{f.fontPx}px;text-align:{f.align};"
            value={typeof value === 'string' ? value : ''}
            maxlength={f.maxLen ?? undefined}
            disabled={f.readOnly}
            oninput={(e) => editorStore.setFormValue(f.fieldName, e.currentTarget.value)}
          ></textarea>
        {:else if f.kind === 'text'}
          <input
            type="text"
            aria-label={f.fieldName}
            class="{fieldClass} px-0.5"
            style="{position}font-size:{f.fontPx}px;text-align:{f.align};"
            value={typeof value === 'string' ? value : ''}
            maxlength={f.maxLen ?? undefined}
            disabled={f.readOnly}
            oninput={(e) => editorStore.setFormValue(f.fieldName, e.currentTarget.value)}
          />
        {:else if f.kind === 'checkbox'}
          <input
            type="checkbox"
            aria-label={f.fieldName}
            class="{fieldClass} cursor-pointer accent-blue-600"
            style={position}
            checked={value === true}
            disabled={f.readOnly}
            onchange={(e) => editorStore.setFormValue(f.fieldName, e.currentTarget.checked)}
          />
        {:else if f.kind === 'radio'}
          <input
            type="radio"
            aria-label="{f.fieldName}: {f.onValue}"
            name="{docId}:{f.fieldName}"
            class="{fieldClass} cursor-pointer accent-blue-600"
            style={position}
            checked={value === f.onValue}
            disabled={f.readOnly}
            onchange={() => editorStore.setFormValue(f.fieldName, f.onValue)}
          />
        {:else}
          <select
            aria-label={f.fieldName}
            class="{fieldClass} cursor-pointer p-0"
            style="{position}font-size:{f.fontPx}px;"
            value={typeof value === 'string' ? value : ''}
            disabled={f.readOnly}
            onchange={(e) => editorStore.setFormValue(f.fieldName, e.currentTarget.value)}
          >
            <option value=""></option>
            {#each f.options as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        {/if}
      {/each}
    </div>
  {/if}

  <!-- Images, then shapes: under signatures and text, as export draws them. -->
  {#each imagesOnCurrentPage as img (img.id)}
    {@const stored = imageFor(img.imageId)}
    {#if stored}
      <PlacedBox
        attr="placed-image"
        id={img.id}
        box={img}
        selected={selectedImageId === img.id}
        label="Image"
        keepAspect
        minSize={16}
        bounds={canvasBounds}
        onSelect={() => (selectedImageId = img.id)}
        onDeselect={() => {
          if (selectedImageId === img.id) selectedImageId = null;
        }}
        onChange={(geometry) => editorStore.updateImage(img.id, geometry)}
        onRemove={() => {
          editorStore.removeImage(img.id);
          selectedImageId = null;
        }}
      >
        <img
          src={stored.url}
          alt=""
          draggable="false"
          class="h-full w-full select-none"
          style:opacity={img.opacity}
        />
      </PlacedBox>
    {/if}
  {/each}

  {#each shapesOnCurrentPage as s (s.id)}
    <PlacedBox
      attr="placed-shape"
      id={s.id}
      box={s}
      selected={$selectedShapeId === s.id}
      label={SHAPE_LABELS[s.kind]}
      minSize={8}
      pad={isLineKind(s.kind) ? 6 : 0}
      bounds={canvasBounds}
      onSelect={() => ($selectedShapeId = s.id)}
      onDeselect={() => {
        if ($selectedShapeId === s.id) $selectedShapeId = null;
      }}
      onChange={(geometry) => editorStore.updateShape(s.id, geometry)}
      onRemove={() => {
        editorStore.removeShape(s.id);
        $selectedShapeId = null;
      }}
    >
      <ShapeGraphic shape={s} />
    </PlacedBox>
  {/each}

  {#if drawingShape}
    {@const kind = $shapeKind}
    <div
      class="pointer-events-none absolute"
      style:left="{drawingShape.x}px"
      style:top="{drawingShape.y}px"
      style:width="{drawingShape.width}px"
      style:height="{drawingShape.height}px"
    >
      <ShapeGraphic
        shape={{
          ...drawingShape,
          kind,
          stroke: $shapeStroke,
          strokeWidth: (isLineKind(kind) ? Math.max(1, $shapeStrokeWidth) : $shapeStrokeWidth) * $editorStore.renderScale,
          fill: isLineKind(kind) ? null : $shapeFill,
          opacity: $shapeOpacity,
        }}
      />
    </div>
  {/if}

  <!-- For "Add image here" in the page's right-click menu. -->
  <input
    bind:this={imageInputEl}
    type="file"
    accept={IMAGE_ACCEPT}
    class="hidden"
    onchange={(e) => {
      const input = e.currentTarget;
      const file = input.files?.[0];
      input.value = '';
      if (file) addImageAt(file, imageMenuPoint ?? undefined);
      imageMenuPoint = null;
    }}
  />

  {#if imageError}
    <div
      role="alert"
      class="absolute left-1/2 top-2 z-50 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1 text-xs text-red-600
        shadow dark:bg-neutral-900/95 dark:text-red-400"
    >
      {imageError}
    </div>
  {/if}

  {#if $clickToPlaceMode && pointerInside && !$redactMode && $signatureStore.previewUrl}
    {@const sig = $signatureStore}
    {@const { width, height } = fitWithinBox(sig.naturalWidth, sig.naturalHeight)}
    <div
      class="pointer-events-none absolute rounded-lg opacity-60"
      style:left="{cursorPos.x - width / 2}px"
      style:top="{cursorPos.y - height / 2}px"
      style:width="{width}px"
      style:height="{height}px"
    >
      <img
        src={$signatureStore.previewUrl}
        alt="Signature preview"
        draggable="false"
        class="h-full w-full select-none object-contain border-2 border-blue-400 rounded-lg"
      />
    </div>
  {/if}

  {#if error}
    <div class="p-4 text-sm text-red-600">{error}</div>
  {/if}

  {#each signaturesOnCurrentPage as sig (sig.id)}
    {@const isSelected = selectedSignatureId === sig.id}
    {@const image = resolveSignature($signatureStore, sig.signatureId)}
    {#if image}
      <!-- role="group" is the closest ARIA fit for a movable/resizable object
           (it groups the resize handle and remove button), but that role is
           classified as non-interactive by Svelte's a11y check even though
           this element is deliberately focusable and arrow-key operable. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        data-placed-signature={sig.id}
        role="group"
        tabindex="0"
        aria-label="Placed signature. Use arrow keys to move, drag the corner handle to resize and the top handle to rotate."
        class="absolute cursor-move touch-none {isSelected ? 'ring-2 ring-blue-400/70 bg-blue-100/10' : ''}"
        style:left="{sig.x}px"
        style:top="{sig.y}px"
        style:width="{sig.width}px"
        style:height="{sig.height}px"
        style:transform={sig.angle ? `rotate(${sig.angle}deg)` : undefined}
        onpointerdown={(e) => onSignaturePointerDown(e, sig.id)}
        onpointermove={(e) => onSignaturePointerMove(e, sig.id)}
        onpointerup={onSignaturePointerUp}
        onfocus={() => (selectedSignatureId = sig.id)}
        onkeydown={(e) => onSignatureKeydown(e, sig.id)}
        ondblclick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'IMG') editSignature(sig.id);
        }}
      >
        <img
          src={image.previewUrl}
          alt="Placed signature"
          draggable="false"
          class="h-full w-full select-none object-contain"
        />

        {#if previewLines.length > 0}
          <div
            class="pointer-events-none absolute inset-0 flex select-none flex-col overflow-hidden leading-tight"
            style:font-size="{sig.height * $watermarkFontScale}px"
            style:color={$watermarkColor}
            style:opacity={$watermarkOpacity}
            style:padding="{sig.height * 0.06}px"
            style:justify-content={previewAlign.justifyContent}
            style:align-items={previewAlign.alignItems}
            style:text-align={previewAlign.textAlign}
          >
            {#each previewLines as line}
              <div>{line}</div>
            {/each}
          </div>
        {/if}

        {#if isSelected}
          <div
            role="button"
            tabindex="0"
            aria-label="Resize signature"
            title="Resize signature (drag, or use arrow keys)"
            class="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-se-resize touch-none rounded-full
              border border-white bg-blue-500 shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
            onpointerdown={(e) => onSignatureResizePointerDown(e, sig.id)}
            onpointermove={(e) => onSignatureResizePointerMove(e, sig.id)}
            onpointerup={onSignatureResizePointerUp}
            onkeydown={(e) => onSignatureResizeKeydown(e, sig.id)}
          ></div>

          <div class="pointer-events-none absolute -top-5 left-1/2 h-5 w-px -translate-x-1/2 bg-blue-500"></div>
          <div
            role="slider"
            tabindex="0"
            aria-label="Rotate signature"
            aria-valuemin={0}
            aria-valuemax={359}
            aria-valuenow={sig.angle ?? 0}
            aria-valuetext="{sig.angle ?? 0} degrees"
            use:tooltip={'Rotate (drag; Shift snaps to 15°). Double-click to straighten'}
            class="absolute -top-7 left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab touch-none rounded-full
              border border-white bg-blue-500 shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
            onpointerdown={(e) => onSignatureRotatePointerDown(e, sig.id)}
            onpointermove={(e) => onSignatureRotatePointerMove(e, sig.id)}
            onpointerup={onSignatureRotatePointerUp}
            ondblclick={() => rotateSignatureBy(sig.id, -(sig.angle ?? 0))}
            onkeydown={(e) => onSignatureRotateKeydown(e, sig.id)}
          ></div>

          <button
            type="button"
            aria-label="Remove placed signature"
            title="Remove placed signature"
            class="absolute -right-1.5 -top-1.5 flex h-5 w-5 touch-none items-center justify-center rounded-full
              border border-white bg-red-500 text-white shadow transition-colors hover:bg-red-600"
            onpointerdown={(e) => e.stopPropagation()}
            onclick={(e) => removeSignature(e, sig.id)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3 w-3">
              <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        {/if}
      </div>
    {/if}
  {/each}

  {#each redactionsOnCurrentPage as box (box.id)}
    {@const isSelected = selectedRedactionId === box.id}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      data-redaction={box.id}
      role="group"
      tabindex="0"
      aria-label="Redacted area, permanently removed on export. Use arrow keys to move, Delete to remove."
      class="absolute cursor-move touch-none bg-black {isSelected ? 'ring-2 ring-blue-400 ring-offset-1' : ''}"
      style:left="{box.x}px"
      style:top="{box.y}px"
      style:width="{box.width}px"
      style:height="{box.height}px"
      onpointerdown={(e) => onRedactionPointerDown(e, box.id)}
      onpointermove={(e) => onRedactionPointerMove(e, box.id)}
      onpointerup={onRedactionPointerUp}
      onfocus={() => (selectedRedactionId = box.id)}
      onkeydown={(e) => onRedactionKeydown(e, box.id)}
    >
      {#if isSelected}
        <div
          role="button"
          tabindex="0"
          aria-label="Resize redacted area"
          title="Resize (drag, or use arrow keys)"
          class="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-se-resize touch-none rounded-full
            border border-white bg-blue-500 shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
          onpointerdown={(e) => onRedactionResizePointerDown(e, box.id)}
          onpointermove={(e) => onRedactionResizePointerMove(e, box.id)}
          onpointerup={onRedactionResizePointerUp}
        ></div>

        <button
          type="button"
          aria-label="Remove redacted area"
          title="Remove redacted area"
          class="absolute -right-1.5 -top-1.5 flex h-5 w-5 touch-none items-center justify-center rounded-full
            border border-white bg-red-500 text-white shadow transition-colors hover:bg-red-600"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => removeRedactionBox(e, box.id)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3 w-3">
            <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      {/if}
    </div>
  {/each}

  {#each textsOnCurrentPage as t (t.id)}
    {@const isSelected = $selectedTextId === t.id}
    {@const isEditing = editingTextId === t.id}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      data-placed-text={t.id}
      role="group"
      tabindex="0"
      aria-label="Text box. Double-click to edit, drag to move, drag the corner handle to resize."
      class="absolute touch-none {isEditing ? '' : 'cursor-move'} {isSelected
        ? 'ring-2 ring-blue-400/70'
        : 'hover:ring-1 hover:ring-blue-300/50'}"
      style:left="{t.x}px"
      style:top="{t.y}px"
      style:width="{t.width}px"
      style:height="{t.height}px"
      onpointerdown={(e) => onTextPointerDown(e, t.id)}
      onpointermove={(e) => onTextPointerMove(e, t.id)}
      onpointerup={onTextPointerUp}
      ondblclick={(e) => onTextDoubleClick(e, t)}
      onfocus={() => ($selectedTextId = t.id)}
      onkeydown={(e) => onTextKeydown(e, t.id)}
    >
      {#if isEditing}
        <!-- svelte-ignore a11y_autofocus -->
        <textarea
          use:autofocusTextarea
          bind:value={textEditValue}
          onpointerdown={(e) => e.stopPropagation()}
          onblur={() => commitTextEdit(t.id)}
          onkeydown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            // Escape attaches whatever's typed (same rule as clicking away)
            // and leaves Add Text mode entirely, rather than staying active
            // for another box — matches Escape's usual meaning of "I'm done".
            commitTextEdit(t.id);
            textToolMode.set(false);
          }}
          class="h-full w-full resize-none border border-dashed border-blue-400 bg-white/70 p-0
            outline-none dark:bg-neutral-900/70"
          style:font-family={FONT_FAMILY_CSS[t.fontFamily]}
          style:font-size="{t.script === 'normal' ? t.fontSize : t.fontSize * SCRIPT_SCALE}px"
          style:font-weight={t.bold ? 700 : 400}
          style:font-style={t.italic ? 'italic' : 'normal'}
          style:text-decoration-line={textDecoration(t)}
          style:color={t.color}
          style:letter-spacing="{t.letterSpacing}px"
          style:word-spacing="{t.wordSpacing}px"
          style:line-height={t.lineHeight}
          style:text-align={t.align}
        ></textarea>
      {:else}
        <!-- The span carries superscript/subscript: smaller and shifted
             within lines that keep the full font size's height. -->
        <div
          class="h-full w-full select-none overflow-hidden whitespace-pre-wrap break-words"
          style:font-family={FONT_FAMILY_CSS[t.fontFamily]}
          style:font-size="{t.fontSize}px"
          style:font-weight={t.bold ? 700 : 400}
          style:font-style={t.italic ? 'italic' : 'normal'}
          style:color={t.color}
          style:background-color={t.background}
          style:opacity={t.opacity}
          style:letter-spacing="{t.letterSpacing}px"
          style:word-spacing="{t.wordSpacing}px"
          style:line-height={t.lineHeight}
          style:text-align={t.align}
        ><span
            class="relative"
            style:font-size={t.script === 'normal' ? null : `${SCRIPT_SCALE}em`}
            style:top="{SCRIPT_SHIFT[t.script] * t.fontSize}px"
            style:text-decoration-line={textDecoration(t)}>{t.text}</span
          ></div>
      {/if}

      {#if isSelected}
        <div
          role="button"
          tabindex="0"
          aria-label="Resize text box"
          title="Resize (drag the handle)"
          class="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-se-resize touch-none rounded-full
            border border-white bg-blue-500 shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
          onpointerdown={(e) => onTextResizePointerDown(e, t.id)}
          onpointermove={(e) => onTextResizePointerMove(e, t.id)}
          onpointerup={onTextResizePointerUp}
        ></div>

        <button
          type="button"
          aria-label="Remove text box"
          title="Remove text box"
          class="absolute -right-1.5 -top-1.5 flex h-5 w-5 touch-none items-center justify-center rounded-full
            border border-white bg-red-500 text-white shadow transition-colors hover:bg-red-600"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => removeText(e, t.id)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3 w-3">
            <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      {/if}
    </div>
  {/each}

  {#each commentsOnCurrentPage as c (c.id)}
    {@const isSelected = selectedCommentId === c.id}
    {@const isEditing = editingCommentId === c.id}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      data-placed-comment={c.id}
      role="group"
      tabindex="0"
      aria-label="{c.groupId ? 'Comment on marked text' : 'Comment marker'}. Double-click to edit, drag to move, Delete to remove."
      title={c.text || 'Empty note. Double-click to edit.'}
      class="absolute flex touch-none items-center justify-center rounded-full bg-amber-400 text-amber-950
        shadow-md cursor-move {isSelected ? 'ring-2 ring-blue-400 ring-offset-1' : 'hover:bg-amber-300'}"
      style:left="{c.x}px"
      style:top="{c.y}px"
      style:width="{c.width}px"
      style:height="{c.height}px"
      onpointerdown={(e) => onCommentPointerDown(e, c.id)}
      onpointermove={(e) => onCommentPointerMove(e, c.id)}
      onpointerup={onCommentPointerUp}
      ondblclick={(e) => onCommentDoubleClick(e, c)}
      onfocus={() => (selectedCommentId = c.id)}
      onkeydown={(e) => onCommentKeydown(e, c.id)}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5">
        <path d="M4 5h16v11H8l-4 4V5Z" />
      </svg>

      {#if isSelected}
        <button
          type="button"
          aria-label="Remove comment"
          title="Remove comment"
          class="absolute -right-1.5 -top-1.5 flex h-5 w-5 touch-none items-center justify-center rounded-full
            border border-white bg-red-500 text-white shadow transition-colors hover:bg-red-600"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => removeComment(e, c.id)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3 w-3">
            <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      {/if}

      {#if isEditing}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="absolute z-10 w-56 rounded-lg border border-neutral-200 bg-white p-2 text-left shadow-lg
            dark:border-neutral-700 dark:bg-neutral-900"
          style:left="0px"
          style:top={c.y < 100 ? `${c.height + 8}px` : '-108px'}
          onpointerdown={(e) => e.stopPropagation()}
        >
          <!-- svelte-ignore a11y_autofocus -->
          <textarea
            use:autofocusNote
            bind:value={commentEditValue}
            placeholder="Write a comment…"
            rows="3"
            onblur={() => commitCommentEdit(c.id)}
            onkeydown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              e.stopPropagation();
              commitCommentEdit(c.id);
              commentToolMode.set(false);
            }}
            class="w-full resize-none rounded border border-neutral-200 bg-transparent p-1.5 text-xs
              text-neutral-900 outline-none focus:ring-1 focus:ring-blue-400 dark:border-neutral-700
              dark:text-neutral-100"
          ></textarea>
        </div>
      {/if}
    </div>
  {/each}

  {#if pendingHighlight}
    <!-- Selection toolbar: highlight / underline / strikethrough in the chosen color. -->
    <div
      role="toolbar"
      aria-label="Mark up selected text"
      tabindex="-1"
      class="absolute z-50 flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-full border
        border-neutral-200 bg-white px-1.5 py-1 text-xs font-medium text-neutral-700 shadow-lg
        dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
      style:left="{pendingHighlight.anchor.x}px"
      style:top="{pendingHighlight.anchor.y}px"
      onpointerdown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {#if selectionFont}
        <span
          class="max-w-[13rem] truncate px-1.5 text-neutral-500 dark:text-neutral-400"
          use:tooltip={selectionFont.detail}
        >
          {selectionFont.label}
        </span>
        <span class="mx-1 h-4 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700"></span>
      {/if}
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors hover:bg-neutral-100
          dark:hover:bg-neutral-800"
        onpointerdown={(e) => applyPendingMarkup(e, 'highlight')}
        onclick={(e) => applyPendingMarkup(e, 'highlight')}
      >
        <span class="h-3 w-3 rounded-sm border border-black/10" style:background-color={$markupColor}></span>
        Highlight
      </button>
      {#each ['underline', 'strikeout'] as const as kind}
        <button
          type="button"
          aria-label={MARKUP_LABELS[kind]}
          use:tooltip={MARKUP_LABELS[kind]}
          class="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-neutral-100
            dark:hover:bg-neutral-800"
          onpointerdown={(e) => applyPendingMarkup(e, kind)}
          onclick={(e) => applyPendingMarkup(e, kind)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
            <path stroke-linecap="round" stroke-linejoin="round" d={MENU_ICONS[kind]} />
          </svg>
        </button>
      {/each}
      <button
        type="button"
        aria-label="Comment"
        use:tooltip={'Comment: highlight this text and add a note to it'}
        class="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-neutral-100
          dark:hover:bg-neutral-800"
        onpointerdown={applyPendingComment}
        onclick={applyPendingComment}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
          <path stroke-linecap="round" stroke-linejoin="round" d={MENU_ICONS.comment} />
        </svg>
      </button>
      <span class="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-700"></span>
      {#each MARKUP_COLORS as c}
        <button
          type="button"
          aria-label="{c.label}"
          aria-pressed={$markupColor === c.value}
          use:tooltip={c.label}
          class="mx-0.5 h-4 w-4 rounded-full border transition-transform hover:scale-110 {$markupColor === c.value
            ? 'border-neutral-700 ring-2 ring-blue-400/50 dark:border-white'
            : 'border-black/10 dark:border-white/20'}"
          style:background-color={c.value}
          onpointerdown={(e) => pickMarkupColor(e, c.value)}
          onclick={(e) => pickMarkupColor(e, c.value)}
        ></button>
      {/each}
    </div>
  {/if}

  {#if drawingBox}
    <div
      class="pointer-events-none absolute border-2 border-dashed border-red-500 bg-black/60"
      style:left="{drawingBox.x}px"
      style:top="{drawingBox.y}px"
      style:width="{drawingBox.width}px"
      style:height="{drawingBox.height}px"
    ></div>
  {/if}

  <!-- Screenshot tool: covers the page (and every overlay on it) so a click
       or drag is always a capture, never a move/resize of something below. -->
  {#if $screenshotToolMode}
    <div
      role="presentation"
      class="absolute inset-0 z-[60] cursor-crosshair touch-none"
      onpointerdown={onShotPointerDown}
      onpointermove={onShotPointerMove}
      onpointerup={onShotPointerUp}
      onpointercancel={() => (shotBox = null)}
    >
      {#if shotBox && (shotBox.width > 0 || shotBox.height > 0)}
        <div
          class="pointer-events-none absolute border-2 border-dashed border-sky-500 bg-sky-400/15"
          style:left="{shotBox.x}px"
          style:top="{shotBox.y}px"
          style:width="{shotBox.width}px"
          style:height="{shotBox.height}px"
        ></div>
      {/if}
      {#if capturing}
        <div class="pointer-events-none absolute inset-0 animate-pulse bg-white/30 dark:bg-black/20"></div>
      {/if}
    </div>
  {/if}

  <!-- Recognize text in an area: like the Screenshot overlay, a drag over
       the page and everything on it. -->
  {#if $ocrAreaMode}
    <div
      role="presentation"
      class="absolute inset-0 z-[60] cursor-crosshair touch-none"
      onpointerdown={onOcrPointerDown}
      onpointermove={onOcrPointerMove}
      onpointerup={onOcrPointerUp}
      onpointercancel={() => (ocrBox = null)}
    >
      {#if ocrBox && (ocrBox.width > 0 || ocrBox.height > 0)}
        <div
          class="pointer-events-none absolute border-2 border-dashed border-blue-500 bg-blue-400/15"
          style:left="{ocrBox.x}px"
          style:top="{ocrBox.y}px"
          style:width="{ocrBox.width}px"
          style:height="{ocrBox.height}px"
        ></div>
      {/if}
    </div>
  {/if}

  <!-- Crop tool: frames the part of the page to keep (CropOverlay). -->
  {#if $cropToolMode}
    <CropOverlay {pageNumber} />
  {/if}
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}
