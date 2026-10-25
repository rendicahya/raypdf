/**
 * Lightweight, local-only "did this PDF pass through RayPDF" check. This is
 * explicitly NOT a cryptographic signature — README.md is clear RayPDF isn't
 * a PKI replacement — it's a small metadata breadcrumb embedded in the PDF's
 * standard Keywords field at export time, and read back on the Verify page.
 * It confirms provenance (this file was exported by RayPDF, with this
 * document id, at this time) but not that the pages haven't been edited
 * since — a full guarantee of that is what the future invisible watermark
 * (see Roadmap in README.md) is for.
 */

import type { PDFDocument } from '@cantoo/pdf-lib';

export interface VerificationRecord {
  v: 1;
  /** Stable per-document id, generated once when the document is loaded into RayPDF (see stores/editor.ts). */
  documentId: string;
  documentName: string;
  /** ISO 8601 timestamp of this export. */
  signedAt: string;
  /** The visible watermark's custom text, if any was set. */
  watermarkText?: string;
}

const MARKER_PREFIX = 'raypdf-verify:v1:';
// Files exported before the app was renamed from Signy carry this prefix
// instead; the record inside is identical, so they still verify.
const LEGACY_MARKER_PREFIX = 'signy-verify:v1:';

function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(token: string): string {
  const padded = token.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (token.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Embeds a verification record into the PDF's standard Keywords metadata field. */
export function embedVerificationRecord(pdfDoc: PDFDocument, record: Omit<VerificationRecord, 'v'>): void {
  const full: VerificationRecord = { v: 1, ...record };
  pdfDoc.setKeywords([MARKER_PREFIX + toBase64Url(JSON.stringify(full))]);
}

/**
 * Reads a verification record back out of a PDF, if present. Searches with a
 * regex rather than assuming a specific Keywords separator, since pdf-lib
 * (and other tools that may have touched the file since) don't guarantee one.
 */
export function extractVerificationRecord(pdfDoc: PDFDocument): VerificationRecord | null {
  const keywords = pdfDoc.getKeywords();
  if (!keywords) return null;

  const match = keywords.match(new RegExp(`(?:${MARKER_PREFIX}|${LEGACY_MARKER_PREFIX})([A-Za-z0-9_-]+)`));
  if (!match) return null;

  try {
    const record = JSON.parse(fromBase64Url(match[1])) as VerificationRecord;
    if (record.v !== 1 || typeof record.documentId !== 'string' || typeof record.signedAt !== 'string') return null;
    return record;
  } catch {
    return null;
  }
}
