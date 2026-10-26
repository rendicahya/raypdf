/**
 * The languages text recognition can read, by Tesseract code. Each one's data
 * comes from its `@tesseract.js-data/<code>` package and is served from ocr/
 * (see `ocrFiles` in vite.config.ts). Only languages written in Western Latin
 * letters are offered: the recognized words are saved in a standard PDF font
 * (`addInvisibleText` in pageOps.ts), which has no other characters.
 */
export const OCR_LANGUAGES = [
  { code: 'eng', label: 'English' },
  { code: 'ind', label: 'Indonesian' },
  { code: 'msa', label: 'Malay' },
  { code: 'nld', label: 'Dutch' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
  { code: 'ita', label: 'Italian' },
  { code: 'por', label: 'Portuguese' },
  { code: 'spa', label: 'Spanish' },
] as const;

export type OcrLanguage = (typeof OCR_LANGUAGES)[number]['code'];

export function ocrLanguageLabel(code: OcrLanguage): string {
  return OCR_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}
