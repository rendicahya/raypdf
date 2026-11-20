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
  import { getPageFormWidgets, widgetValue } from '../lib/pdf/forms';
  import WatermarkPreview from './page/WatermarkPreview.svelte';
  import PageLabelsPreview from './page/PageLabelsPreview.svelte';
  import PageLinks from './page/PageLinks.svelte';
  import PageFormFields, { type FormBox } from './page/PageFormFields.svelte';
  import AreaDragOverlay from './page/AreaDragOverlay.svelte';
  import SelectionMarkupBar from './page/SelectionMarkupBar.svelte';
  import MarkupOptionsBar from './page/MarkupOptionsBar.svelte';
  import RedactionLayer from './page/RedactionLayer.svelte';
  import CommentLayer from './page/CommentLayer.svelte';
  import TextBoxLayer from './page/TextBoxLayer.svelte';
  import { TextEditing } from './page/textEditing.svelte';
  import { CommentEditing } from './page/commentEditing.svelte';
  import { PageSelection, setPageContext } from './page/pageContext.svelte';
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
  import ItemSelection from './ItemSelection.svelte';
  import {
    itemSelection,
    itemRefOf,
    sameItem,
    alignSelection,
    distributeSelection,
    duplicateSelection,
    deleteSelection,
    duplicateItemsOnPage,
  } from '../stores/itemSelection';
  import ShapeGraphic from './ShapeGraphic.svelte';
  import {
    shapeToolMode,
    selectedShapeId,
    shapeKind,
    shapeStroke,
    shapeStrokeWidth,
    shapeFill,
    shapeOpacity,
    shapeArrowHead,
    shapeLineStyle,
    isLineKind,
    SHAPE_LABELS,
  } from '../stores/shapeTool';
  import { cropToolMode } from '../stores/cropTool';
  import CropOverlay from './CropOverlay.svelte';
  import { addImageFile, imageFor, isImageFile, pendingImage, IMAGE_ACCEPT } from '../stores/images';
  import { isDocumentFile } from '../stores/addDocuments';
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
    type PlacedHighlight,
    type PlacedShape,
    type PlacedImage,
    type ItemRef,
  } from '../stores/editor';
  import { pageFilter } from '../lib/utils/stableList';
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
  } from '../stores/textTool';
  import { signatureStore, resolveSignature } from '../stores/signature';
  import { openSignatureTool } from '../stores/tools';
  import { openTextTool, openShapeTool, openImageProperties, imagePropertiesId } from '../stores/toolPanel';
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

  // This page's own selection, shared with the layers it's built from (components/page/).
  const sel = new PageSelection();
  // Opening and saving comment notes, for this page and its CommentLayer.
  const commentEditing = new CommentEditing(sel, (groupId) => removeHighlight(groupId));
  const textEditing = new TextEditing(sel);
  setPageContext({ selection: sel, commentEditing, textEditing, canvasRect: () => canvasEl.getBoundingClientRect() });

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
    if (sel.editingCommentId) commentEditing.commit();
    const id = editorStore.addHighlight(pageNumber, boxes, 'highlight', $markupColor, noteBeside(boxes));
    pendingHighlight = null;
    window.getSelection()?.removeAllRanges();
    if (!id) return;
    commentEditing.start(id, '', true);
  }

  /** Opens the note of a markup, adding one beside it if it has none. */
  function commentOnMarkup(groupId: string) {
    const doc = $activeDocument;
    if (!doc) return;
    if (sel.editingCommentId) commentEditing.commit();
    selectedHighlightGroup = null;
    const existing = doc.comments.find((c) => c.groupId === groupId);
    if (existing) {
            commentEditing.start(existing.id, existing.text);
      return;
    }
    const boxes = doc.highlights.filter((h) => h.groupId === groupId);
    if (boxes.length === 0) return;
    const id = editorStore.addComment({ ...noteBeside(boxes), page: boxes[0].page, text: '', groupId });
        commentEditing.start(id, '');
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

  // The zoom and the view's rotation as values of their own: effects that read
  // them re-run only when they change, not on every edit to the store (reading
  // $editorStore or $activeDocument directly in an effect subscribes to all of it).
  const renderScale = $derived($editorStore.renderScale);
  const viewRotation = $derived($activeDocument?.rotation ?? 0);

  // After a page edit or undo swaps the file, the page number can briefly point
  // past the end of the previous parse until the new one has loaded.
  const pageExists = $derived(pageNumber <= pdfDoc.numPages);

  // Re-render the page whenever the zoom level, rotation, or the file changes.
  // Reads only those values, not the whole $activeDocument, so edits don't
  // re-render every visible page.
  $effect(() => {
    const scale = renderScale;
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
    const scale = renderScale;
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
  let formBoxes: FormBox[] = $state([]);
  const formValues = $derived($activeDocument?.formValues ?? {});

  $effect(() => {
    const loaded = pdfDoc;
    const rotation = viewRotation;
    const scale = renderScale;
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
      resizingSignatureId ||
      drawingShape ||
      // A layer's own drag (RedactionLayer): the pointer is captured by the item.
      (e.buttons !== 0 && !!(e.target as Element | null)?.closest?.('[data-redaction], [data-placed-comment], [data-placed-text]')) ||
      !!(e.target as Element | null)?.closest?.('[data-placed-box]') ||
      // Resting on a link keeps it clickable rather than turning into text
      // selection (a drag already selecting text carries on across it).
      (e.buttons === 0 && !!(e.target as Element | null)?.closest?.('[data-pdf-link]'));

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
  // Each list keeps its identity while nothing on this page changes (see
  // lib/utils/stableList.ts), so an edit elsewhere doesn't re-render this page.
  const onPage = {
    signatures: pageFilter<PlacedSignature>(),
    redactions: pageFilter<RedactionBox>(),
    texts: pageFilter<PlacedText>(),
    comments: pageFilter<PlacedComment>(),
    highlights: pageFilter<PlacedHighlight>(),
    shapes: pageFilter<PlacedShape>(),
    images: pageFilter<PlacedImage>(),
  };
  const signaturesOnCurrentPage = $derived(onPage.signatures($activeDocument?.placedSignatures, pageNumber));
  const redactionsOnCurrentPage = $derived(onPage.redactions($activeDocument?.redactions, pageNumber));
  const textsOnCurrentPage = $derived(onPage.texts($activeDocument?.texts, pageNumber));
  // Page number, header, and footer, previewed as lib/pdf/headerFooter.ts
  // will draw them.
  // Read as values of their own, so the labels are worked out again only when
  // one of them changes, not on every edit.
  const docPageNumbers = $derived($activeDocument?.pageNumbers ?? null);
  const docHeaderFooter = $derived($activeDocument?.headerFooter ?? null);
  const docPageCount = $derived($activeDocument?.pageCount ?? 0);
  const docFileName = $derived($activeDocument?.file.name ?? null);
  const edgeLabels = $derived(
    docFileName !== null
      ? pageLabels(docPageNumbers, docHeaderFooter, pageNumber, docPageCount, docFileName, headerFooterDate())
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
  const commentsOnCurrentPage = $derived(onPage.comments($activeDocument?.comments, pageNumber));
  const highlightsOnCurrentPage = $derived(onPage.highlights($activeDocument?.highlights, pageNumber));
  const shapesOnCurrentPage = $derived(onPage.shapes($activeDocument?.shapes, pageNumber));
  const imagesOnCurrentPage = $derived(onPage.images($activeDocument?.images, pageNumber));

  // The one item this page has selected on its own (not a group, see
  // ItemSelection), for starting a group, duplicating, and the like.
  function currentItem(): ItemRef | null {
    if (selectedSignatureId) return { kind: 'signature', id: selectedSignatureId };
    if ($selectedTextId && textsOnCurrentPage.some((t) => t.id === $selectedTextId)) {
      return { kind: 'text', id: $selectedTextId };
    }
    if ($selectedShapeId && shapesOnCurrentPage.some((s) => s.id === $selectedShapeId)) {
      return { kind: 'shape', id: $selectedShapeId };
    }
    if (selectedImageId) return { kind: 'image', id: selectedImageId };
    return null;
  }

  function clearSingleSelection() {
    selectedSignatureId = null;
    selectedImageId = null;
    sel.redactionId = null;
    if ($selectedTextId && textsOnCurrentPage.some((t) => t.id === $selectedTextId)) $selectedTextId = null;
    if ($selectedShapeId && shapesOnCurrentPage.some((s) => s.id === $selectedShapeId)) $selectedShapeId = null;
  }

  function selectSingle(ref: ItemRef) {
    clearSingleSelection();
    if (ref.kind === 'signature') selectedSignatureId = ref.id;
    else if (ref.kind === 'text') $selectedTextId = ref.id;
    else if (ref.kind === 'shape') $selectedShapeId = ref.id;
    else selectedImageId = ref.id;
  }

  /** Copies one item next to itself and selects the copy. */
  function duplicateItem(ref: ItemRef) {
    const [copy] = duplicateItemsOnPage([ref], canvasBounds());
    if (copy) selectSingle(copy);
  }

  /** Everything on this page that can be selected together, in drawing order. */
  function pageItemRefs(): ItemRef[] {
    return [
      ...imagesOnCurrentPage.map((i) => ({ kind: 'image' as const, id: i.id })),
      ...shapesOnCurrentPage.map((s) => ({ kind: 'shape' as const, id: s.id })),
      ...signaturesOnCurrentPage.map((s) => ({ kind: 'signature' as const, id: s.id })),
      ...textsOnCurrentPage.map((t) => ({ kind: 'text' as const, id: t.id })),
    ];
  }

  function selectAllItems() {
    const items = pageItemRefs();
    if (!$activeDocument || items.length === 0) return;
    clearSingleSelection();
    itemSelection.set({ docId: $activeDocument.id, page: pageNumber, items });
  }

  // Ctrl+D duplicates the item selected on this page (a group handles its own).
  function onWindowKeydown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'd') return;
    if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const ref = currentItem();
    if (!ref || sel.editingTextId) return;
    e.preventDefault();
    duplicateItem(ref);
  }

  function canvasBounds() {
    const rect = canvasEl.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  // Shapes tool: drag on the page to draw the chosen shape (Ctrl keeps a
  // square, a circle, or a line at 45° steps; Shift draws out from the
  // starting point as the centre); a plain click draws nothing.
  // The tool stays on, so several can be drawn in a row.
  const SHAPE_DRAW_MIN = 6;
  let drawingShape: { x: number; y: number; width: number; height: number; flipX: boolean; flipY: boolean } | null =
    $state(null);
  let shapeStart = { x: 0, y: 0 };

  $effect(() => {
    if (!$shapeToolMode) drawingShape = null;
  });

  function shapeDraft(e: PointerEvent) {
    const rect = canvasEl.getBoundingClientRect();
    const { x: sx, y: sy } = shapeStart;
    let dx = e.clientX - rect.left - sx;
    let dy = e.clientY - rect.top - sy;
    const keepAspect = e.ctrlKey || e.metaKey;
    const fromCentre = e.shiftKey;
    if (keepAspect) {
      if (isLineKind($shapeKind)) {
        const step = Math.PI / 4;
        const angle = Math.round(Math.atan2(dy, dx) / step) * step;
        const length = Math.hypot(dx, dy);
        dx = Math.cos(angle) * length;
        dy = Math.sin(angle) * length;
      } else {
        const size = Math.max(Math.abs(dx), Math.abs(dy));
        dx = dx < 0 ? -size : size;
        dy = dy < 0 ? -size : size;
      }
    }
    // How far the pointer's end may go on each side and still stay on the
    // page; from the centre, the opposite end has to fit too.
    const limitX = Math.min(dx < 0 ? sx : rect.width - sx, fromCentre ? Math.min(sx, rect.width - sx) : Infinity);
    const limitY = Math.min(dy < 0 ? sy : rect.height - sy, fromCentre ? Math.min(sy, rect.height - sy) : Infinity);
    if (keepAspect) {
      // Shrink both together, so the square or the line's angle holds.
      const t = Math.min(1, Math.abs(dx) > 0 ? limitX / Math.abs(dx) : 1, Math.abs(dy) > 0 ? limitY / Math.abs(dy) : 1);
      dx *= t;
      dy *= t;
    } else {
      dx = clamp(dx, -limitX, limitX);
      dy = clamp(dy, -limitY, limitY);
    }
    const ox = fromCentre ? sx - dx : sx;
    const oy = fromCentre ? sy - dy : sy;
    return {
      x: Math.min(ox, sx + dx),
      y: Math.min(oy, sy + dy),
      width: Math.abs(dx) * (fromCentre ? 2 : 1),
      height: Math.abs(dy) * (fromCentre ? 2 : 1),
      flipX: dx < 0,
      flipY: dy < 0,
    };
  }

  function finishShape(box: NonNullable<typeof drawingShape>) {
    const kind = $shapeKind;
    const scale = renderScale;
    // A click (or a tiny drag) draws nothing: a shape needs dragging out.
    if (Math.max(box.width, box.height) < SHAPE_DRAW_MIN) return;
    $selectedShapeId = editorStore.addShape({
      ...box,
      page: pageNumber,
      kind,
      stroke: $shapeStroke,
      strokeWidth: (isLineKind(kind) ? Math.max(1, $shapeStrokeWidth) : $shapeStrokeWidth) * scale,
      fill: isLineKind(kind) ? null : $shapeFill,
      opacity: $shapeOpacity,
      ...(kind === 'arrow' ? { arrowHead: $shapeArrowHead } : {}),
      ...($shapeLineStyle !== 'solid' ? { lineStyle: $shapeLineStyle } : {}),
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

    const currentRedaction = sel.redactionId
      ? wrapperEl?.querySelector(`[data-redaction="${sel.redactionId}"]`)
      : null;
    if (!currentRedaction?.contains(e.target as Node)) sel.redactionId = null;

    if ((e.target as Element | null)?.closest?.('[data-highlight-group]')?.getAttribute('data-highlight-group') !== selectedHighlightGroup) {
      selectedHighlightGroup = null;
    }

    // Deliberately doesn't touch sel.editingTextId/commitTextEdit here: this
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
      sel.editingTextId !== $selectedTextId
    ) {
      $selectedTextId = null;
    }

    // Same reasoning as currentText above — the just-created comment marker
    // isn't painted into the DOM yet on the pointerdown that creates it.
    const currentComment = sel.commentId
      ? wrapperEl?.querySelector(`[data-placed-comment="${sel.commentId}"]`)
      : null;
    if (!currentComment?.contains(e.target as Node) && sel.editingCommentId !== sel.commentId) {
      if (sel.editingCommentId) commentEditing.commit();
      sel.commentId = null;
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
    isDragOver = !isDocumentDrag(e);
  }

  // A PDF being dragged in from outside opens as a tab (App handles that), so
  // the page doesn't light up for it as it does for a signature or picture.
  function isDocumentDrag(e: DragEvent) {
    return Array.from(e.dataTransfer?.items ?? []).some((item) => item.kind === 'file' && item.type === 'application/pdf');
  }

  function onDrop(e: DragEvent) {
    if (isPageDrag(e)) return;
    isDragOver = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    // Documents are left to bubble up to App, which opens each in a tab.
    if (files.some(isDocumentFile)) return;
    e.preventDefault();
    // The signature panel tags each dragged signature with its id. Checked
    // first: Chrome also attaches a dragged <img> as a file, which would
    // otherwise be added as a plain image, without the watermark.
    const signatureId = e.dataTransfer?.getData(SIGNATURE_DRAG_TYPE);
    if (signatureId) {
      placeSignatureAt(e, signatureId);
      return;
    }
    // Anything else (a .txt, a zip, text from another app) is nothing to place.
    const imageFile = files.find(isImageFile);
    if (imageFile) addImageAt(imageFile, { clientX: e.clientX, clientY: e.clientY });
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
      // first, otherwise reassigning sel.editingTextId to the new box below
      // would discard the previous one's typed text unsaved.
      if (sel.editingTextId) textEditing.commit();
      addTextAt(e);
      return;
    }

    if ($commentToolMode) {
      // Same reasoning as the Add Text branch above — prevent focus theft and
      // stop this pointerdown from also reaching the window-level "click
      // outside closes the editor" listener before the new marker is painted.
      e.preventDefault();
      e.stopPropagation();
      if (sel.editingCommentId) commentEditing.commit();
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
  // With `fromCentre` (Shift while dragging) the centre stays put instead.
  function resizedFromCorner(origin: PlacedSignature, targetWidth: number, fromCentre = false) {
    const { width, height } = clampedResize(targetWidth, origin, fromCentre);
    if (fromCentre) {
      const cx = origin.x + origin.width / 2;
      const cy = origin.y + origin.height / 2;
      return { width, height, x: cx - width / 2, y: cy - height / 2 };
    }
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
  function clampedResize(
    targetWidth: number,
    origin: PlacedSignature,
    fromCentre = false,
  ): { width: number; height: number } {
    const rect = canvasEl.getBoundingClientRect();
    const aspect = origin.width / origin.height;
    // A turned signature grows from its turned corner, so the page edges
    // only limit it to the page's own size. Growing from the centre, the
    // nearer edge does.
    const turned = !!origin.angle;
    const cx = origin.x + origin.width / 2;
    const cy = origin.y + origin.height / 2;
    const maxWidth = turned
      ? rect.width
      : fromCentre
        ? 2 * Math.min(cx, rect.width - cx)
        : rect.width - origin.x;
    const maxHeight = turned
      ? rect.height
      : fromCentre
        ? 2 * Math.min(cy, rect.height - cy)
        : rect.height - origin.y;

    let width = clamp(targetWidth, MIN_SIZE, maxWidth);
    let height = width / aspect;

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
    const grow = e.shiftKey ? 2 : 1;
    editorStore.updateSignature(id, resizedFromCorner(resizeStart, resizeStart.width + grow * along, e.shiftKey));
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
      sel.redactionId = null;
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
  // the whole page; a drag captures just the rectangle drawn (AreaDragOverlay).
  // See lib/pdf/screenshot.ts: the area is handed over as fractions of the
  // page so the capture can be rendered at its own, higher resolution.
  let capturing = $state(false);

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
      renderScale: renderScale,
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

  // Text tool: click to drop a text box (in textToolMode), then type directly
  // into it. Move/resize mirror the redaction box (a plain rectangle, no
  // aspect-ratio lock) rather than the signature.
  const TEXT_DEFAULT_WIDTH = 220;

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
    textEditing.start(id, '');
  }

  // Comment tool: click to drop a fixed-size sticky-note marker (in
  // commentToolMode), then type its note. Move mirrors the signature/text
  // overlays (plain pointerdown/move/up, no resize — the marker is always
  // the same size); editing opens a floating note panel rather than turning
  // the marker itself into a textarea, since the marker is too small to type into.
  const COMMENT_SIZE = 26;

  const selectedCommentGroup = $derived(
    sel.commentId ? ($activeDocument?.comments.find((c) => c.id === sel.commentId)?.groupId ?? null) : null,
  );

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
    commentEditing.start(id, '');
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

    const duplicate = (ref: ItemRef): ContextMenuItem => ({
      label: 'Duplicate',
      icon: MENU_ICONS.duplicate,
      hint: 'Ctrl+D',
      onSelect: () => duplicateItem(ref),
    });

    // An item in a group selection: the group's menu.
    const group = $itemSelection;
    const hit = itemRefOf(target);
    if (group && hit && group.docId === doc.id && group.page === pageNumber && group.items.some((i) => sameItem(i, hit))) {
      const count = group.items.length;
      const bounds = canvasBounds();
      const alignTo = count === 1 ? ' of the page' : '';
      return [
        { label: `Align left${alignTo}`, icon: MENU_ICONS.alignLeft, onSelect: () => alignSelection('left', bounds) },
        { label: `Align center${alignTo}`, icon: MENU_ICONS.alignCenter, onSelect: () => alignSelection('center', bounds) },
        { label: `Align right${alignTo}`, icon: MENU_ICONS.alignRight, onSelect: () => alignSelection('right', bounds) },
        { label: `Align top${alignTo}`, icon: MENU_ICONS.alignTop, separatorBefore: true, onSelect: () => alignSelection('top', bounds) },
        { label: `Align middle${alignTo}`, icon: MENU_ICONS.alignMiddle, onSelect: () => alignSelection('middle', bounds) },
        { label: `Align bottom${alignTo}`, icon: MENU_ICONS.alignBottom, onSelect: () => alignSelection('bottom', bounds) },
        {
          label: 'Distribute horizontally',
          icon: MENU_ICONS.distributeH,
          separatorBefore: true,
          disabled: count < 3,
          onSelect: () => distributeSelection('horizontal'),
        },
        {
          label: 'Distribute vertically',
          icon: MENU_ICONS.distributeV,
          disabled: count < 3,
          onSelect: () => distributeSelection('vertical'),
        },
        {
          label: count === 1 ? 'Duplicate' : `Duplicate ${count} items`,
          icon: MENU_ICONS.duplicate,
          hint: 'Ctrl+D',
          separatorBefore: true,
          onSelect: () => duplicateSelection(bounds),
        },
        { ...deleteItem(count === 1 ? 'Delete' : `Delete ${count} items`, deleteSelection) },
      ];
    }

    const shapeId = idOf('data-placed-shape');
    const shape = shapeId ? doc.shapes.find((s) => s.id === shapeId) : undefined;
    if (shape) {
      $selectedShapeId = shape.id;
      // No Edit item: a shape is edited in place. Properties (or a
      // double-click) opens its style in the side panel.
      return [
        {
          label: 'Properties',
          icon: MENU_ICONS.properties,
          onSelect: () => {
            $selectedShapeId = shape.id;
            openShapeTool();
          },
        },
        duplicate({ kind: 'shape', id: shape.id }),
        {
          ...deleteItem('Delete', () => {
            editorStore.removeShape(shape.id);
            $selectedShapeId = null;
          }),
          separatorBefore: true,
        },
      ];
    }

    const placedImageId = idOf('data-placed-image');
    if (placedImageId) {
      selectedImageId = placedImageId;
      return [
        {
          label: 'Properties',
          icon: MENU_ICONS.properties,
          onSelect: () => {
            selectedImageId = placedImageId;
            openImageProperties(placedImageId);
          },
        },
        duplicate({ kind: 'image', id: placedImageId }),
        {
          ...deleteItem('Delete image', () => {
            editorStore.removeImage(placedImageId);
            selectedImageId = null;
          }),
          separatorBefore: true,
        },
      ];
    }

    const signatureId = idOf('data-placed-signature');
    if (signatureId) {
      selectedSignatureId = signatureId;
      const angle = doc.placedSignatures.find((s) => s.id === signatureId)?.angle ?? 0;
      return [
        { label: 'Edit signature', icon: MENU_ICONS.edit, onSelect: () => editSignature(signatureId) },
        duplicate({ kind: 'signature', id: signatureId }),
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
      sel.redactionId = redactionId;
      return [
        deleteItem('Delete redaction', () => {
          editorStore.removeRedaction(redactionId);
          sel.redactionId = null;
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
            openTextTool();
            textEditing.start(text.id, text.text);
          },
        },
        {
          label: 'Properties',
          icon: MENU_ICONS.properties,
          onSelect: () => {
            $selectedTextId = text.id;
            openTextTool();
          },
        },
        duplicate({ kind: 'text', id: text.id }),
        {
          ...deleteItem('Delete text', () => {
            editorStore.removeText(text.id);
            $selectedTextId = null;
          }),
          separatorBefore: true,
        },
      ];
    }

    const commentId = idOf('data-placed-comment');
    const comment = commentId ? doc.comments.find((c) => c.id === commentId) : undefined;
    if (comment) {
      sel.commentId = comment.id;
      return [
        {
          label: 'Edit comment',
          icon: MENU_ICONS.edit,
          onSelect: () => {
                        commentEditing.start(comment.id, comment.text);
          },
        },
        deleteItem('Delete comment', () => {
          editorStore.removeComment(comment.id);
          sel.commentId = null;
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
          if (sel.editingTextId) textEditing.commit();
          addTextAt(point);
        },
      },
      {
        label: 'Add comment here',
        icon: MENU_ICONS.comment,
        onSelect: () => {
          if (sel.editingCommentId) commentEditing.commit();
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
      {
        label: 'Select all objects',
        icon: MENU_ICONS.selectAll,
        separatorBefore: true,
        disabled: pageItemRefs().length === 0,
        onSelect: selectAllItems,
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

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

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

  <!-- Watermark, page number, header, and footer previews: drawn as export draws them. -->
  {#if watermark && watermarkStamps.length > 0}
    <WatermarkPreview {watermark} stamps={watermarkStamps} image={watermarkImage} unit={renderScale} />
  {/if}
  <PageLabelsPreview labels={edgeLabels} unit={renderScale} />

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

  <!-- The selected markup's own toolbar: recolor, comment, or remove. -->
  {#each highlightsOnCurrentPage.filter((h) => h.groupId === selectedHighlightGroup).slice(0, 1) as h (h.id)}
    <MarkupOptionsBar
      markup={h}
      hasNote={commentsOnCurrentPage.some((c) => c.groupId === h.groupId)}
      onRecolor={(color) => editorStore.recolorHighlight(h.groupId, color)}
      onComment={() => commentOnMarkup(h.groupId)}
      onRemove={() => removeHighlight(h.groupId)}
    />
  {/each}

  <!-- The PDF's own links, clickable whenever form fields are (Move mode). -->
  <PageLinks {pdfDoc} {pageNumber} rotation={viewRotation} scale={renderScale} active={formFieldsInteractive} />

  <!-- The PDF's own form fields, taking input only in Move mode (see formFieldsInteractive). -->
  <PageFormFields boxes={formBoxes} values={formValues} interactive={formFieldsInteractive} {docId} />

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
        onSelect={() => {
          selectedImageId = img.id;
          // The properties panel follows the selection to another image.
          if ($imagePropertiesId) $imagePropertiesId = img.id;
        }}
        onDeselect={() => {
          if (selectedImageId === img.id) selectedImageId = null;
          // Closed when the click went anywhere but another image, which
          // takes the panel over in the same click.
          setTimeout(() => {
            if ($imagePropertiesId === img.id && selectedImageId !== img.id) $imagePropertiesId = null;
          });
        }}
        onChange={(geometry) => editorStore.updateImage(img.id, geometry)}
        onRemove={() => {
          editorStore.removeImage(img.id);
          selectedImageId = null;
        }}
        onDoubleClick={() => openImageProperties(img.id)}
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
      onDoubleClick={() => {
        $selectedShapeId = s.id;
        openShapeTool();
      }}
      angle={s.angle}
      onRotate={isLineKind(s.kind) ? undefined : (angle) => editorStore.updateShape(s.id, { angle })}
      line={isLineKind(s.kind) ? { flipX: s.flipX, flipY: s.flipY } : undefined}
      onLineChange={(geometry) => editorStore.updateShape(s.id, geometry)}
    >
      <ShapeGraphic shape={s} />
    </PlacedBox>
  {/each}

  {#if drawingShape}
    {@const kind = $shapeKind}
    <!-- A dashed frame while dragging, so the shape shows even with no outline (or no fill). -->
    <div
      class="pointer-events-none absolute {isLineKind(kind) ? '' : 'outline-dashed outline-1 outline-blue-500/80'}"
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
          strokeWidth: (isLineKind(kind) ? Math.max(1, $shapeStrokeWidth) : $shapeStrokeWidth) * renderScale,
          fill: isLineKind(kind) ? null : $shapeFill,
          opacity: $shapeOpacity,
          arrowHead: $shapeArrowHead,
          lineStyle: $shapeLineStyle,
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
            data-resize-handle
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

  <RedactionLayer boxes={redactionsOnCurrentPage} />

  <TextBoxLayer texts={textsOnCurrentPage} />

  <CommentLayer comments={commentsOnCurrentPage} />

  <!-- The toolbar over selected text: mark it up, or comment on it. -->
  {#if pendingHighlight}
    <SelectionMarkupBar
      anchor={pendingHighlight.anchor}
      font={selectionFont}
      onMarkup={applyPendingMarkup}
      onComment={applyPendingComment}
      onPickColor={pickMarkupColor}
    />
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

  <!-- Screenshot, and Recognize text in an area: a drag over the page and
       everything on it. A screenshot click (or tiny drag) captures the whole
       page; for text recognition it does nothing, so the user can still
       scroll to another page to drag on. -->
  {#if $screenshotToolMode}
    <AreaDragOverlay
      frameClass="border-sky-500 bg-sky-400/15"
      disabled={capturing}
      busy={capturing}
      onDone={(area) => capturePageImage(area, $screenshotDestination)}
    />
  {/if}
  {#if $ocrAreaMode}
    <AreaDragOverlay
      frameClass="border-blue-500 bg-blue-400/15"
      onDone={(area) => area && recognizeTextInArea(pageNumber, area)}
    />
  {/if}

  <!-- Crop tool: frames the part of the page to keep (CropOverlay). -->
  {#if $cropToolMode}
    <CropOverlay {pageNumber} />
  {/if}

  <!-- Several items selected together: outlines, the arrange bar, group moves. -->
  <ItemSelection
    {pageNumber}
    bounds={canvasBounds}
    {currentItem}
    clearSingle={clearSingleSelection}
  />
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}
