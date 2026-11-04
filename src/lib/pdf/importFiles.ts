/** Everything that can be added as a document: PDFs, and Markdown converted to PDF on the way in. */
export const DOCUMENT_ACCEPT = 'application/pdf,.pdf,.md,.markdown,text/markdown';

function needsConverting(file: File): boolean {
  return file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf');
}

/**
 * Swaps Markdown files for PDFs, keeping their order. The converter (and its
 * parser) only loads when a Markdown file is actually added.
 */
export async function toPdfFiles(files: File[]): Promise<{ pdfs: File[]; messages: string[] }> {
  if (!files.some(needsConverting)) return { pdfs: files, messages: [] };

  const { markdownToPdf } = await import('./fromMarkdown');
  const pdfs: File[] = [];
  const failed: string[] = [];
  const replaced: string[] = [];

  for (const file of files) {
    if (!needsConverting(file)) {
      pdfs.push(file);
      continue;
    }
    try {
      const result = await markdownToPdf(file);
      pdfs.push(result.file);
      if (result.replacedCharacters > 0) replaced.push(`${file.name} (${result.replacedCharacters})`);
    } catch (err) {
      console.error('Could not convert Markdown', err);
      failed.push(file.name);
    }
  }

  const messages: string[] = [];
  if (failed.length > 0) messages.push(`Could not convert: ${failed.join(', ')}`);
  if (replaced.length > 0) messages.push(`Some characters aren't supported and show as "?": ${replaced.join(', ')}`);
  return { pdfs, messages };
}
