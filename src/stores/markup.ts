import { persistedWritable } from '../lib/utils/persist';
import { MARKUP_COLORS } from '../lib/pdf/highlight';

/** Color for the next highlight, underline, or strikethrough — the last one picked. */
export const markupColor = persistedWritable<string>('markupColor', MARKUP_COLORS[0].value);
