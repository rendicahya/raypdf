<script lang="ts">
  import { onMount } from 'svelte';
  import { renderPageToCanvas, type PdfDocument } from '../lib/pdf/loader';
  import { renderTextLayer, cancelTextLayer } from '../lib/pdf/textLayer';
  import { getCachedPdf } from '../lib/pdf/docCache';
  import { PAGE_DRAG_TYPE } from '../lib/pdf/pageOps';
  import { capturePage, copyImageToClipboard, type CaptureOverlays } from '../lib/pdf/screenshot';
  import { getPageFormWidgets, widgetValue, type FormWidget } from '../lib/pdf/forms';
  import { getTotalRotation } from '../lib/pdf/loader';
  import { HIGHLIGHT_COLOR, selectionToBoxes, type Box } from '../lib/pdf/highlight';
  import { MENU_ICONS } from '../lib/utils/menuIcons';
  import ContextMenu, { type ContextMenuItem } from './ContextMenu.svelte';
  import { applyVisibleWatermark } from '../lib/watermark/visible';
  import { screenshotToolMode, screenshotResult } from '../stores/screenshotTool';
  import { editorStore, activeDocument, type PlacedSignature, type PlacedText, type RedactionBox, type PlacedComment } from '../stores/editor';
  import { redactMode } from '../stores/redact';
  import { commentToolMode } from '../stores/commentTool';
  import { clickToPlaceMode } from '../stores/clickToPlace';
  import { zoomToolMode } from '../stores/zoomTool';
  import { textSelectMode } from '../stores/textSelect';
  import {
    textToolMode,
    defaultTextFontFamily,
    defaultTextFontSize,
    defaultTextBold,
    defaultTextItalic,
    defaultTextUnderline,
    defaultTextColor,
    defaultTextLetterSpacing,
    defaultTextAlign,
    FONT_FAMILY_CSS,
    FONT_FAMILY_LABELS,
    TEXT_FONT_SIZE_MIN,
    TEXT_FONT_SIZE_MAX,
    TEXT_LETTER_SPACING_MIN,
    TEXT_LETTER_SPACING_MAX,
  } from '../stores/textTool';
  import { signatureStore, resolveSignature } from '../stores/signature';
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
  import { signatureSuggestion } from '../stores/signatureSuggestion';

  let canvasEl: HTMLCanvasElement;
  let wrapperEl: HTMLDivElement;
  let textLayerEl: HTMLDivElement;
  let pdfDoc: PdfDocument | null = $state(null);
  let error: string | null = $state(null);
  let isDragOver = $state(false);
  let cursorPos = $state({ x: 0, y: 0 });

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

  // This component is remounted (via a #key block in App.svelte) whenever
  // the active document changes; within one document the file itself can
  // still be swapped (reordering pages, or undoing that), so reload on that too.
  // Only the identity of the document/file matters here — depending on the
  // whole $activeDocument would reload on every edit.
  const docId = $derived($activeDocument?.id ?? null);
  const docFile = $derived($activeDocument?.file ?? null);

  $effect(() => {
    const id = docId;
    const file = docFile;
    if (id === null || !file) return;
    let cancelled = false;
    getCachedPdf(id, file)
      .then((loaded) => {
        if (cancelled) return;
        pdfDoc = loaded;
        error = null;
        editorStore.setPageCount(loaded.numPages);
      })
      .catch((e) => {
        if (!cancelled) error = e instanceof Error ? e.message : 'Failed to load PDF';
      });
    return () => {
      cancelled = true;
    };
  });

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
      if (pointerHeld || !hasTextSelection) pendingHighlight = null;
      else updatePendingHighlight();
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

  // Highlighting: once text is selected, a Highlight button appears below it
  // (like Foxit's selection popup) and turns the selection into a permanent
  // highlight — one box per line, saved as a PDF Highlight annotation on export.
  let pendingHighlight: { boxes: Box[]; anchor: { x: number; y: number } } | null = $state(null);
  let selectedHighlightGroup: string | null = $state(null);
  // Whether text on this page runs top to bottom (a page turned 90°/270°),
  // which changes how selected spans join into lines.
  let pageVertical = $state(false);

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
    pendingHighlight = {
      boxes,
      anchor: {
        x: clamp(last.x + last.width, 50, canvasRect.width - 50),
        y: below ? last.y + last.height + 6 : Math.max(0, first.y - 38),
      },
    };
  }

  function applyPendingHighlight(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    highlightSelection();
  }

  function highlightSelection() {
    const doc = $activeDocument;
    if (!doc || !pendingHighlight) return;
    editorStore.addHighlight(doc.pageNumber, pendingHighlight.boxes);
    pendingHighlight = null;
    window.getSelection()?.removeAllRanges();
  }

  function removeHighlight(groupId: string) {
    editorStore.removeHighlight(groupId);
    if (selectedHighlightGroup === groupId) selectedHighlightGroup = null;
  }

  // After a page edit or undo swaps the file, the page number can briefly point
  // past the end of the previous parse until the new one has loaded.
  function pageExists(doc: { pageNumber: number }, loaded: PdfDocument): boolean {
    return doc.pageNumber <= loaded.numPages;
  }

  // Re-render the current page whenever the page number, zoom level, rotation, or the document changes.
  $effect(() => {
    const doc = $activeDocument;
    const scale = $editorStore.renderScale;
    if (!doc || !pdfDoc || !canvasEl || !pageExists(doc, pdfDoc)) return;
    renderPageToCanvas(pdfDoc, doc.pageNumber, canvasEl, scale, doc.rotation).catch((e) => {
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
    const doc = $activeDocument;
    const scale = $editorStore.renderScale;

    if (!textLayerEl) return;
    if (!doc || !pdfDoc || !pageExists(doc, pdfDoc)) {
      cancelTextLayer(textLayerEl);
      return;
    }

    renderTextLayer(pdfDoc, doc.pageNumber, textLayerEl, scale, doc.rotation).catch((e) => {
      error = e instanceof Error ? e.message : 'Failed to render selectable text';
    });

    return () => cancelTextLayer(textLayerEl);
  });

  // The PDF's own form fields on this page (lib/pdf/forms.ts), positioned in
  // canvas pixels. pdf.js leaves form widgets out of the canvas render, so
  // these HTML inputs are what the user sees and types into. Recomputed only
  // when the page view changes, not on every edit.
  type FormBox = FormWidget & { left: number; top: number; boxWidth: number; boxHeight: number; fontPx: number };
  let formBoxes: FormBox[] = $state([]);
  const viewPage = $derived($activeDocument?.pageNumber ?? 1);
  const viewRotation = $derived($activeDocument?.rotation ?? 0);
  const formValues = $derived($activeDocument?.formValues ?? {});

  $effect(() => {
    const loaded = pdfDoc;
    const pageNumber = viewPage;
    const rotation = viewRotation;
    const scale = $editorStore.renderScale;
    if (!loaded || pageNumber > loaded.numPages) {
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
    const pageNumber = viewPage;
    const rotation = viewRotation;
    if (!loaded || pageNumber > loaded.numPages) return;
    let cancelled = false;
    loaded
      .getPage(pageNumber)
      .then((page) => {
        if (!cancelled) pageVertical = getTotalRotation(page, rotation) % 180 !== 0;
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
      !$zoomToolMode &&
      !$textSelectMode &&
      !$screenshotToolMode,
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
      $zoomToolMode ||
      $textSelectMode ||
      $screenshotToolMode;
    const otherInteractionInProgress =
      isPanning ||
      drawingBox ||
      movingSignatureId ||
      movingRedactionId ||
      movingTextId ||
      movingCommentId ||
      resizingSignatureId ||
      resizingRedactionId ||
      resizingTextId;

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
  }

  // Only show placements when we're looking at their page.
  const signaturesOnCurrentPage = $derived.by(() => {
    const doc = $activeDocument;
    if (!doc) return [];
    return doc.placedSignatures.filter((sig) => sig.page === doc.pageNumber);
  });

  const redactionsOnCurrentPage = $derived.by(() => {
    const doc = $activeDocument;
    if (!doc) return [];
    return doc.redactions.filter((box) => box.page === doc.pageNumber);
  });

  const textsOnCurrentPage = $derived.by(() => {
    const doc = $activeDocument;
    if (!doc) return [];
    return doc.texts.filter((t) => t.page === doc.pageNumber);
  });

  const commentsOnCurrentPage = $derived.by(() => {
    const doc = $activeDocument;
    if (!doc) return [];
    return doc.comments.filter((c) => c.page === doc.pageNumber);
  });

  const highlightsOnCurrentPage = $derived.by(() => {
    const doc = $activeDocument;
    if (!doc) return [];
    return doc.highlights.filter((h) => h.page === doc.pageNumber);
  });

  // The "Find Signature Spot" suggestion — only shown while it's scoped to
  // the document/page currently on screen, so navigating away (or the
  // document changing) doesn't leave a stale box floating in the wrong place.
  const suggestion = $derived.by(() => {
    const doc = $activeDocument;
    const s = $signatureSuggestion;
    if (!doc || !s || s.documentId !== doc.id || s.page !== doc.pageNumber) return null;
    return s;
  });

  function placeSuggestedSignature() {
    const s = suggestion;
    if (!s) return;
    const signatureId = $signatureStore.activeId;
    if (!signatureId) return;
    const id = editorStore.addSignature({ x: s.x, y: s.y, width: s.width, height: s.height, page: s.page, signatureId });
    selectedSignatureId = id;
    signatureSuggestion.set(null);
  }

  function dismissSuggestion(e: MouseEvent) {
    e.stopPropagation();
    signatureSuggestion.set(null);
  }

  // The move/resize/remove controls only show while a signature is
  // "selected" — right after it's placed, or after the user clicks it again
  // — and hide once the user clicks anywhere else, so signatures don't
  // permanently sit under a distracting border and handles.
  let selectedSignatureId: string | null = $state(null);

  // Reset selection when the page changes.
  let lastPageForSelection: number | undefined;
  $effect(() => {
    const page = $activeDocument?.pageNumber;
    if (page === lastPageForSelection) return;
    lastPageForSelection = page;
    selectedSignatureId = null;
    selectedRedactionId = null;
    if (editingTextId) commitTextEdit();
    selectedTextId = null;
    if (editingCommentId) commitCommentEdit();
    selectedCommentId = null;
    selectedHighlightGroup = null;
    pendingHighlight = null;
  });

  function onWindowPointerDown(e: PointerEvent) {
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
    const currentText = selectedTextId ? wrapperEl?.querySelector(`[data-placed-text="${selectedTextId}"]`) : null;
    if (!currentText?.contains(e.target as Node) && editingTextId !== selectedTextId) {
      selectedTextId = null;
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
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && !textLayerEl?.contains(e.target as Node)) {
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
    // The signature panel tags each dragged signature with its id.
    placeSignatureAt(e, e.dataTransfer?.getData(SIGNATURE_DRAG_TYPE) || undefined);
  }

  function onCanvasMouseMove(e: PointerEvent) {
    const rect = canvasEl.getBoundingClientRect();
    cursorPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // Zoom tool: clicking the document zooms in one step, keeping the clicked
  // point anchored under the cursor (like the zoom tool in Acrobat/Figma)
  // rather than just re-centering on the page. The canvas resizes
  // asynchronously (renderPageToCanvas awaits pdf.js), so the scroll
  // adjustment can't be computed up front — a ResizeObserver fires once the
  // canvas has actually taken on its new size, and only then is the scroll
  // position corrected using the ratio captured before the click.
  // Right-click zooms out instead of in.
  function zoomAtPoint(e: PointerEvent, direction: 'in' | 'out') {
    const zoom = direction === 'in' ? editorStore.zoomIn : editorStore.zoomOut;
    const container = wrapperEl?.closest('[data-pdf-scroll-container]') as HTMLElement | null;
    const oldScale = $editorStore.renderScale;
    const oldRect = canvasEl.getBoundingClientRect();

    if (!container || oldRect.width === 0 || oldRect.height === 0) {
      zoom();
      return;
    }

    // Where the click landed as a fraction across the canvas (scale-independent)...
    const xRatio = clamp((e.clientX - oldRect.left) / oldRect.width, 0, 1);
    const yRatio = clamp((e.clientY - oldRect.top) / oldRect.height, 0, 1);
    // ...and the exact screen position that fraction should stay pinned to.
    const anchorX = e.clientX;
    const anchorY = e.clientY;

    zoom();
    if ($editorStore.renderScale === oldScale) return; // already at the zoom limit — nothing to reposition

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(fallback);
      const newRect = canvasEl.getBoundingClientRect();
      container.scrollLeft += newRect.left + xRatio * newRect.width - anchorX;
      container.scrollTop += newRect.top + yRatio * newRect.height - anchorY;
    };
    const observer = new ResizeObserver(finish);
    observer.observe(canvasEl);
    // Safety net in case the canvas never actually resizes (e.g. the render
    // fails) — don't leave the observer watching forever.
    const fallback = setTimeout(finish, 1000);
  }

  function onCanvasClick(e: PointerEvent) {
    if ($zoomToolMode) {
      if (e.button === 0) zoomAtPoint(e, 'in');
      else if (e.button === 2) zoomAtPoint(e, 'out');
      return;
    }

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

    const placement = { x, y, width, height, page: doc.pageNumber, signatureId: sig.id };
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
    const overlayRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    moveOffset = { x: e.clientX - overlayRect.left, y: e.clientY - overlayRect.top };
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
    const { width, height } = clampedResize(sig.width + (grow ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP), sig);
    editorStore.updateSignature(id, { width, height });
    rememberPlacement({ ...sig, width, height });
  }

  // Shared by the pointer-drag and keyboard paths: grows/shrinks toward
  // `targetWidth` from `origin`'s position, preserving aspect ratio and
  // clamping so the signature never overflows the page or drops below MIN_SIZE.
  function clampedResize(targetWidth: number, origin: PlacedSignature): { width: number; height: number } {
    const rect = canvasEl.getBoundingClientRect();
    const aspect = origin.width / origin.height;

    let width = clamp(targetWidth, MIN_SIZE, rect.width - origin.x);
    let height = width / aspect;

    const maxHeight = rect.height - origin.y;
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
    const deltaX = e.clientX - resizeStart.pointerX;
    const { width, height } = clampedResize(resizeStart.width + deltaX, resizeStart);
    editorStore.updateSignature(id, { width, height });
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
      !$zoomToolMode &&
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
    if (drawingBox) {
      const doc = $activeDocument;
      const box = drawingBox;
      drawingBox = null;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      if (!doc || box.width < REDACT_DRAW_MIN_SIZE || box.height < REDACT_DRAW_MIN_SIZE) return;
      editorStore.addRedaction({ ...box, page: doc.pageNumber });
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
    captureToClipboard(area);
  }

  /** Captures the page (or an area of it, as fractions) to the clipboard, reporting through the screenshot toast. */
  function captureToClipboard(area: Parameters<typeof capturePage>[3]) {
    const doc = $activeDocument;
    if (!doc || !pdfDoc || capturing) return;

    const baseName = doc.file.name.replace(/\.pdf$/i, '');
    const fileName = `${baseName}_page${doc.pageNumber}${area ? '_area' : ''}.png`;

    capturing = true;
    const png = captureWithEdits(pdfDoc, doc, area);
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
      highlights: highlightsOnCurrentPage,
      redactions: redactionsOnCurrentPage,
      signatures,
      texts: textsOnCurrentPage,
    };
    return capturePage(loaded, doc.pageNumber, doc.rotation, area, overlays);
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

  let selectedTextId: string | null = $state(null);
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
    const height = $defaultTextFontSize * 1.6;
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
      page: doc.pageNumber,
      text: '',
      fontFamily: $defaultTextFontFamily,
      fontSize: $defaultTextFontSize,
      bold: $defaultTextBold,
      italic: $defaultTextItalic,
      underline: $defaultTextUnderline,
      color: $defaultTextColor,
      letterSpacing: $defaultTextLetterSpacing,
      align: $defaultTextAlign,
    });
    selectedTextId = id;
    startEditingText(id, '');
  }

  function onTextDoubleClick(e: MouseEvent, t: PlacedText) {
    e.stopPropagation();
    selectedTextId = t.id;
    startEditingText(t.id, t.text);
  }

  let movingTextId: string | null = null;
  let textMoveOffset = { x: 0, y: 0 };

  function onTextPointerDown(e: PointerEvent, id: string) {
    if (editingTextId === id) return;
    e.stopPropagation();
    selectedTextId = id;
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
      if (selectedTextId === id) selectedTextId = null;
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
    if (selectedTextId === id) selectedTextId = null;
  }

  // Style toolbar edits apply to the selected box and become the default for
  // the next text box placed, mirroring how the watermark panel's settings persist.
  function setTextStyle(id: string, partial: Partial<PlacedText>) {
    editorStore.updateText(id, partial);
    if ('fontFamily' in partial) defaultTextFontFamily.set(partial.fontFamily!);
    if ('fontSize' in partial) defaultTextFontSize.set(partial.fontSize!);
    if ('bold' in partial) defaultTextBold.set(partial.bold!);
    if ('italic' in partial) defaultTextItalic.set(partial.italic!);
    if ('underline' in partial) defaultTextUnderline.set(partial.underline!);
    if ('color' in partial) defaultTextColor.set(partial.color!);
    if ('letterSpacing' in partial) defaultTextLetterSpacing.set(partial.letterSpacing!);
    if ('align' in partial) defaultTextAlign.set(partial.align!);
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
    // An empty note is just clutter — drop it rather than leaving a blank marker.
    if (!value.trim()) {
      editorStore.removeComment(id);
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
      page: doc.pageNumber,
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

  function onDocumentContextMenu(e: MouseEvent) {
    const target = e.target as HTMLElement;
    // Text fields keep the browser's own menu (spelling, paste, …).
    if (target.closest('input, textarea, select')) return;
    e.preventDefault();
    // The Zoom tool's right-click zooms out; Screenshot owns every click on the page.
    if ($zoomToolMode || $screenshotToolMode) return;
    const doc = $activeDocument;
    if (!doc) return;
    const items = menuItemsFor(e, target, doc);
    if (items.length > 0) menu = { x: e.clientX, y: e.clientY, items };
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
  ): ContextMenuItem[] {
    const idOf = (attr: string) => target.closest(`[${attr}]`)?.getAttribute(attr) ?? null;
    const deleteItem = (label: string, remove: () => void): ContextMenuItem => ({
      label,
      icon: MENU_ICONS.delete,
      hint: 'Del',
      danger: true,
      onSelect: remove,
    });

    const signatureId = idOf('data-placed-signature');
    if (signatureId) {
      selectedSignatureId = signatureId;
      return [
        deleteItem('Delete signature', () => {
          editorStore.removeSignature(signatureId);
          selectedSignatureId = null;
        }),
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
      selectedTextId = text.id;
      return [
        {
          label: 'Edit text',
          icon: MENU_ICONS.edit,
          onSelect: () => {
            selectedTextId = text.id;
            startEditingText(text.id, text.text);
          },
        },
        deleteItem('Delete text', () => {
          editorStore.removeText(text.id);
          selectedTextId = null;
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
        {
          label: 'Highlight',
          icon: MENU_ICONS.highlight,
          disabled: boxes.length === 0,
          onSelect: () => {
            editorStore.addHighlight(doc.pageNumber, boxes);
            pendingHighlight = null;
            window.getSelection()?.removeAllRanges();
          },
        },
      ];
    }

    const point: ClientPoint = { clientX: e.clientX, clientY: e.clientY };

    const groupId = idOf('data-highlight-group') ?? highlightAt(point)?.groupId;
    if (groupId) {
      selectedHighlightGroup = groupId;
      return [deleteItem('Remove highlight', () => removeHighlight(groupId))];
    }

    const page = doc.pageNumber;
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
        onSelect: () => captureToClipboard(null),
      },
    ];
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div
  bind:this={wrapperEl}
  role="region"
  aria-label="PDF page — drop the signature here"
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
    class:cursor-crosshair={$redactMode}
    class:cursor-text={($textToolMode || $commentToolMode) && !$redactMode}
    class:cursor-zoom-in={$zoomToolMode && !$redactMode && !$textToolMode && !$commentToolMode}
    class:cursor-grab={!$redactMode &&
      !$textToolMode &&
      !$commentToolMode &&
      !$clickToPlaceMode &&
      !$zoomToolMode &&
      !textSelectActive}
    onpointerdown={onCanvasClick}
    onpointermove={onCanvasMouseMove}
    oncontextmenu={(e) => {
      if ($zoomToolMode) e.preventDefault();
    }}
  ></canvas>

  <!-- Invisible, selectable text built by lib/pdf/textLayer.ts — always
       built (see the $effect above) so hover hit-testing has real geometry
       to check, but only receives pointer events while textSelectActive
       (the manual Select toggle, or a live hover-trigger) is true, so it
       never steals clicks/drags meant for the canvas or the other overlays
       below in every other mode. -->
  <div bind:this={textLayerEl} class="pdf-text-layer" class:pointer-events-none={!textSelectActive}></div>

  <!-- Highlights sit above the text layer so they can be clicked (then
       removed) in Move mode; in every other mode they let clicks through, so
       the Select tool can still select highlighted text. -->
  {#each highlightsOnCurrentPage as h, i (h.id)}
    {@const isSelected = selectedHighlightGroup === h.groupId}
    {@const isFirstOfGroup = highlightsOnCurrentPage.findIndex((x) => x.groupId === h.groupId) === i}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      data-highlight-group={h.groupId}
      role="group"
      tabindex={isFirstOfGroup ? 0 : -1}
      aria-label="Highlighted text — Delete to remove"
      class="absolute cursor-pointer mix-blend-multiply {isSelected ? 'outline outline-2 outline-blue-400' : ''}"
      class:pointer-events-none={!formFieldsInteractive}
      style:left="{h.x}px"
      style:top="{h.y}px"
      style:width="{h.width}px"
      style:height="{h.height}px"
      style:background-color={HIGHLIGHT_COLOR}
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
    ></div>
  {/each}

  <!-- Outside the highlight boxes, which are multiplied onto the page and
       would tint anything inside them. -->
  {#each highlightsOnCurrentPage.filter((h) => h.groupId === selectedHighlightGroup).slice(0, 1) as h (h.id)}
    <button
      type="button"
      data-highlight-group={h.groupId}
      aria-label="Remove highlight"
      title="Remove highlight"
      class="absolute flex h-5 w-5 -translate-y-1.5 translate-x-[-0.875rem] touch-none items-center justify-center
        rounded-full border border-white bg-red-500 text-white shadow transition-colors hover:bg-red-600"
      style:left="{h.x + h.width}px"
      style:top="{h.y}px"
      onpointerdown={(e) => e.stopPropagation()}
      onclick={(e) => {
        e.stopPropagation();
        removeHighlight(h.groupId);
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3 w-3">
        <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
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

  {#if $clickToPlaceMode && !$redactMode && $signatureStore.previewUrl}
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

  {#if suggestion && $signatureStore.previewUrl}
    <div
      role="button"
      tabindex="0"
      class="absolute cursor-pointer touch-none rounded-lg ring-2 ring-blue-400 ring-offset-2 animate-pulse"
      style:left="{suggestion.x}px"
      style:top="{suggestion.y}px"
      style:width="{suggestion.width}px"
      style:height="{suggestion.height}px"
      title="Best guess — {suggestion.reason}. Click to place here."
      aria-label="Suggested signature placement — {suggestion.reason}. Press Enter to place here."
      onclick={placeSuggestedSignature}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          placeSuggestedSignature();
        }
      }}
    >
      <img
        src={$signatureStore.previewUrl}
        alt="Suggested signature placement"
        draggable="false"
        class="h-full w-full select-none object-contain opacity-70"
      />
      <button
        type="button"
        aria-label="Dismiss suggested placement"
        title="Dismiss"
        class="absolute -right-1.5 -top-1.5 flex h-5 w-5 touch-none items-center justify-center rounded-full
          border border-white bg-neutral-500 text-white shadow transition-colors hover:bg-neutral-600"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={dismissSuggestion}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3 w-3">
          <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <span
        class="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full
          bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white shadow"
      >
        Click to place
      </span>
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
        aria-label="Placed signature — use arrow keys to move, drag the corner handle to resize"
        class="absolute cursor-move touch-none {isSelected ? 'ring-2 ring-blue-400/70 bg-blue-100/10' : ''}"
        style:left="{sig.x}px"
        style:top="{sig.y}px"
        style:width="{sig.width}px"
        style:height="{sig.height}px"
        onpointerdown={(e) => onSignaturePointerDown(e, sig.id)}
        onpointermove={(e) => onSignaturePointerMove(e, sig.id)}
        onpointerup={onSignaturePointerUp}
        onfocus={() => (selectedSignatureId = sig.id)}
        onkeydown={(e) => onSignatureKeydown(e, sig.id)}
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
      aria-label="Redacted area — permanently removed on export. Use arrow keys to move, Delete to remove."
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
    {@const isSelected = selectedTextId === t.id}
    {@const isEditing = editingTextId === t.id}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      data-placed-text={t.id}
      role="group"
      tabindex="0"
      aria-label="Text box — double-click to edit, drag to move, drag the corner handle to resize"
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
      onfocus={() => (selectedTextId = t.id)}
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
          style:font-size="{t.fontSize}px"
          style:font-weight={t.bold ? 700 : 400}
          style:font-style={t.italic ? 'italic' : 'normal'}
          style:text-decoration={t.underline ? 'underline' : 'none'}
          style:color={t.color}
          style:letter-spacing="{t.letterSpacing}px"
          style:line-height="1.2"
          style:text-align={t.align}
        ></textarea>
      {:else}
        <div
          class="h-full w-full select-none overflow-hidden whitespace-pre-wrap break-words"
          style:font-family={FONT_FAMILY_CSS[t.fontFamily]}
          style:font-size="{t.fontSize}px"
          style:font-weight={t.bold ? 700 : 400}
          style:font-style={t.italic ? 'italic' : 'normal'}
          style:text-decoration={t.underline ? 'underline' : 'none'}
          style:color={t.color}
          style:letter-spacing="{t.letterSpacing}px"
          style:line-height="1.2"
          style:text-align={t.align}
        >
          {t.text}
        </div>
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

        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="absolute z-10 flex items-center gap-1 whitespace-nowrap rounded-full border border-neutral-200
            bg-white px-2 py-1 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          style:left="0px"
          style:top={t.y < 48 ? `${t.height + 8}px` : '-40px'}
          onpointerdown={(e) => e.stopPropagation()}
        >
          <select
            aria-label="Font family"
            class="rounded border-none bg-transparent py-0.5 pr-4 text-xs focus:outline-none focus:ring-1
              focus:ring-blue-400 dark:text-neutral-100"
            value={t.fontFamily}
            onchange={(e) => setTextStyle(t.id, { fontFamily: (e.target as HTMLSelectElement).value as PlacedText['fontFamily'] })}
          >
            {#each Object.entries(FONT_FAMILY_LABELS) as [value, label]}
              <option {value}>{label}</option>
            {/each}
          </select>

          <input
            type="number"
            aria-label="Font size"
            title="Font size (scroll to adjust)"
            min={TEXT_FONT_SIZE_MIN}
            max={TEXT_FONT_SIZE_MAX}
            class="w-10 rounded border border-neutral-200 bg-transparent px-1 py-0.5 text-xs focus:outline-none
              focus:ring-1 focus:ring-blue-400 dark:border-neutral-700 dark:text-neutral-100"
            value={Math.round(t.fontSize)}
            onchange={(e) =>
              setTextStyle(t.id, {
                fontSize: clamp(Number((e.target as HTMLInputElement).value), TEXT_FONT_SIZE_MIN, TEXT_FONT_SIZE_MAX),
              })}
            onwheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 1 : -1;
              setTextStyle(t.id, { fontSize: clamp(t.fontSize + delta, TEXT_FONT_SIZE_MIN, TEXT_FONT_SIZE_MAX) });
            }}
          />

          <button
            type="button"
            aria-pressed={t.bold}
            title="Bold"
            class="flex h-6 w-6 items-center justify-center rounded font-bold {t.bold
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400'
              : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'}"
            onclick={() => setTextStyle(t.id, { bold: !t.bold })}
          >
            B
          </button>
          <button
            type="button"
            aria-pressed={t.italic}
            title="Italic"
            class="flex h-6 w-6 items-center justify-center rounded italic {t.italic
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400'
              : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'}"
            onclick={() => setTextStyle(t.id, { italic: !t.italic })}
          >
            I
          </button>
          <button
            type="button"
            aria-pressed={t.underline}
            title="Underline"
            class="flex h-6 w-6 items-center justify-center rounded underline {t.underline
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400'
              : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'}"
            onclick={() => setTextStyle(t.id, { underline: !t.underline })}
          >
            U
          </button>

          <div class="flex items-center gap-0.5 border-l border-neutral-200 pl-1 dark:border-neutral-700">
            {#each [{ value: 'left', d: 'M4 6h16M4 12h10M4 18h14' }, { value: 'center', d: 'M4 6h16M7 12h10M5 18h14' }, { value: 'right', d: 'M4 6h16M10 12h10M6 18h14' }] as opt}
              <button
                type="button"
                aria-pressed={t.align === opt.value}
                title="Align {opt.value}"
                class="flex h-6 w-6 items-center justify-center rounded {t.align === opt.value
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400'
                  : 'text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'}"
                onclick={() => setTextStyle(t.id, { align: opt.value as PlacedText['align'] })}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                  <path stroke-linecap="round" d={opt.d} />
                </svg>
              </button>
            {/each}
          </div>

          <input
            type="color"
            aria-label="Text color"
            title="Text color"
            value={t.color}
            onchange={(e) => setTextStyle(t.id, { color: (e.target as HTMLInputElement).value })}
            class="h-6 w-6 cursor-pointer rounded border border-neutral-300 bg-transparent p-0
              dark:border-neutral-600"
          />

          <label class="flex items-center gap-1 text-neutral-500 dark:text-neutral-400" title="Letter spacing">
            <span class="text-[10px]">A↔B</span>
            <input
              type="range"
              min={TEXT_LETTER_SPACING_MIN}
              max={TEXT_LETTER_SPACING_MAX}
              step="0.5"
              value={t.letterSpacing}
              oninput={(e) => setTextStyle(t.id, { letterSpacing: Number((e.target as HTMLInputElement).value) })}
              class="w-16 accent-blue-600"
            />
          </label>
        </div>
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
      aria-label="Comment marker — double-click to edit, drag to move, Delete to remove"
      title={c.text || 'Empty note — double-click to edit'}
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
    <button
      type="button"
      class="absolute z-50 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border
        border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-lg transition-colors
        hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200
        dark:hover:bg-neutral-800"
      style:left="{pendingHighlight.anchor.x}px"
      style:top="{pendingHighlight.anchor.y}px"
      onpointerdown={applyPendingHighlight}
      onclick={applyPendingHighlight}
    >
      <span class="h-3 w-3 rounded-sm border border-amber-400" style:background-color={HIGHLIGHT_COLOR}></span>
      Highlight
    </button>
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
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}
