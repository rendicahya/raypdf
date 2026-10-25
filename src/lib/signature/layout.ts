/** dataTransfer type carrying a saved signature's id while it's dragged from the signature panel onto a page. */
export const SIGNATURE_DRAG_TYPE = 'application/x-raypdf-signature';

/**
 * Fits an image's natural dimensions inside a max box while preserving
 * aspect ratio, so a placed signature is never stretched or squashed.
 */
export function fitWithinBox(
  naturalWidth: number,
  naturalHeight: number,
  maxSize = 180,
): { width: number; height: number } {
  if (!naturalWidth || !naturalHeight) {
    return { width: maxSize, height: maxSize / 2 };
  }

  const ratio = naturalWidth / naturalHeight;

  return ratio >= 1
    ? { width: maxSize, height: maxSize / ratio }
    : { width: maxSize * ratio, height: maxSize };
}
