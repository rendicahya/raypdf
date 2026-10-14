import {
  PDFBool,
  PDFCheckBox,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  type PDFDocument,
} from '@cantoo/pdf-lib';
import type { PdfDocument } from './loader';

/**
 * Filling in a PDF's own (AcroForm) fields. pdf.js reads the fields of a page
 * for the editor, which draws plain HTML inputs over them; the values the
 * user enters are kept per document by field name and written into the real
 * fields by pdf-lib at export, so the result stays a normal fillable form.
 */

/** Field values by fully qualified field name: text/choice/radio values are strings, checkboxes booleans. */
export type FormValues = Record<string, string | boolean>;

export type FormWidgetKind = 'text' | 'checkbox' | 'radio' | 'select';

/** One widget (the visible box) of a form field on a page. A radio group has one widget per option. */
export interface FormWidget {
  id: string;
  fieldName: string;
  kind: FormWidgetKind;
  /** [x1, y1, x2, y2] in PDF points. */
  rect: number[];
  readOnly: boolean;
  multiLine: boolean;
  maxLen: number | null;
  /** The value this checkbox/radio button stands for when it's on. */
  onValue: string;
  options: { value: string; label: string }[];
  /** The value stored in the PDF itself, used until the user changes it. */
  initial: string | boolean;
  /** In PDF points; 0 means "fit to the box". */
  fontSize: number;
  align: 'left' | 'center' | 'right';
}

const WIDGET_ANNOTATION = 20;
const ALIGNMENTS = ['left', 'center', 'right'] as const;

/** pdf.js's annotation data — loosely typed there, so only the fields used here are listed. */
interface WidgetData {
  id: string;
  annotationType: number;
  fieldType?: string;
  fieldName?: string;
  fieldValue?: unknown;
  rect: number[];
  hidden?: boolean;
  readOnly?: boolean;
  multiLine?: boolean;
  maxLen?: number;
  checkBox?: boolean;
  radioButton?: boolean;
  exportValue?: string;
  buttonValue?: string;
  options?: { exportValue: string; displayValue: string }[];
  textAlignment?: number;
  defaultAppearanceData?: { fontSize?: number };
}

function firstString(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

function toWidget(a: WidgetData): FormWidget | null {
  if (a.annotationType !== WIDGET_ANNOTATION || a.hidden || !a.fieldName) return null;

  let kind: FormWidgetKind;
  let initial: string | boolean;
  let onValue = '';
  if (a.fieldType === 'Tx') {
    kind = 'text';
    initial = firstString(a.fieldValue);
  } else if (a.fieldType === 'Ch') {
    kind = 'select';
    initial = firstString(a.fieldValue);
  } else if (a.fieldType === 'Btn' && a.checkBox) {
    kind = 'checkbox';
    onValue = a.exportValue ?? 'Yes';
    const value = firstString(a.fieldValue);
    initial = value !== '' && value !== 'Off';
  } else if (a.fieldType === 'Btn' && a.radioButton) {
    kind = 'radio';
    onValue = a.buttonValue ?? '';
    initial = firstString(a.fieldValue);
  } else {
    return null; // push buttons and signature fields aren't fillable
  }

  return {
    id: a.id,
    fieldName: a.fieldName,
    kind,
    rect: a.rect,
    readOnly: !!a.readOnly,
    multiLine: !!a.multiLine,
    maxLen: a.maxLen && a.maxLen > 0 ? a.maxLen : null,
    onValue,
    options: (a.options ?? []).map((o) => ({ value: o.exportValue, label: o.displayValue || o.exportValue })),
    initial,
    fontSize: a.defaultAppearanceData?.fontSize ?? 0,
    align: ALIGNMENTS[a.textAlignment ?? 0] ?? 'left',
  };
}

/** The fillable form widgets on one page (1-indexed). */
export async function getPageFormWidgets(pdfDoc: PdfDocument, pageNumber: number): Promise<FormWidget[]> {
  const page = await pdfDoc.getPage(pageNumber);
  const annotations = (await page.getAnnotations({ intent: 'display' })) as WidgetData[];
  return annotations.map(toWidget).filter((w): w is FormWidget => w !== null);
}

/** What a widget shows: the user's value if they changed the field, otherwise the PDF's own. */
export function widgetValue(widget: FormWidget, values: FormValues): string | boolean {
  return values[widget.fieldName] ?? widget.initial;
}

/**
 * pdf.js identifies a radio button by its widget's "on" state name, which
 * pdf-lib doesn't accept directly: when the field lists its options
 * separately (/Opt) the state names are just indices ("0", "1", …). pdf-lib
 * pairs its i-th option with the i-th widget, so match on that.
 */
function radioOption(field: PDFRadioGroup, onValue: string): string | undefined {
  if (onValue === '' || onValue === 'Off') return undefined;
  const options = field.getOptions();
  const index = field.acroField.getWidgets().findIndex((w) => w.getOnValue()?.decodeText() === onValue);
  if (index >= 0 && index < options.length) return options[index];
  return options.includes(onValue) ? onValue : undefined;
}

/**
 * Writes the user's values into the document's real form fields. Fields that
 * no longer exist (e.g. their page was deleted) or reject a value are skipped
 * rather than failing the whole export.
 */
export function fillFormFields(pdfDoc: PDFDocument, values: FormValues): void {
  const entries = Object.entries(values);
  if (entries.length === 0) return;

  const form = pdfDoc.getForm();
  for (const [name, value] of entries) {
    try {
      const field = form.getField(name);
      if (field instanceof PDFTextField) {
        field.setText(typeof value === 'string' && value !== '' ? value : undefined);
      } else if (field instanceof PDFCheckBox) {
        if (value === true) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        const option = typeof value === 'string' ? radioOption(field, value) : undefined;
        if (option !== undefined) field.select(option);
        else field.clear();
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        if (typeof value === 'string' && value !== '') field.select(value);
        else field.clear();
      }
    } catch {
      // Unknown field or an unsupported value — leave this field as it was.
    }
  }

  try {
    form.updateFieldAppearances();
  } catch {
    // pdf-lib's standard fonts can't draw every character; ask the reader to
    // draw the fields itself instead.
    form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  }
}
