import { get } from 'svelte/store';
import { editorStore, type PdfDocumentState } from './editor';
import { signatureStore } from './signature';
import { currentWatermarkOptions } from './watermark';
import { stripEmbeddedScripts } from './exportOptions';
import {
  documentExportParams,
  exportSignedPdf,
  hasSomethingToExport,
  type ExportParams,
  type ExportSettings,
} from '../lib/pdf/export';

/** The user's current export settings: the saved signatures, zoom, signature watermark, and script stripping. */
export function currentExportSettings(): ExportSettings {
  return {
    signatureFor: signatureStore.lookup(),
    renderScale: get(editorStore).renderScale,
    watermark: currentWatermarkOptions(),
    stripScripts: get(stripEmbeddedScripts),
  };
}

/**
 * The document as it would be saved with the current settings, everything
 * placed on it included. `overrides` adjust this one save (see `documentExportParams`).
 */
export function exportDocument(doc: PdfDocumentState, overrides: Partial<ExportParams> = {}): Promise<Uint8Array> {
  return exportSignedPdf(documentExportParams(doc, currentExportSettings(), overrides));
}

/** Throws the message Save shows when a document has nothing added yet. */
export function assertSomethingToExport(doc: PdfDocumentState): void {
  if (!hasSomethingToExport(doc, currentExportSettings())) {
    throw new Error(
      'Nothing to export yet. Place a signature, fill in a form, edit the pages, or add a redaction, text, or comment first.',
    );
  }
}
