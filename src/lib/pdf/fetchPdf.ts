import { MAX_PDF_SIZE_BYTES, formatFileSize } from '../utils/fileValidation';

/**
 * Downloads a PDF from a link straight into the browser. There's no server
 * in between (RayPDF has none), so this only works when the other site
 * allows web pages to fetch its files (CORS). Many do, for example GitHub's
 * raw files and Dropbox downloads; plenty don't, and then the user has to
 * download the file and add it themselves.
 */

/** Rewrites share-page links that have a direct-download equivalent. */
function directDownloadUrl(url: URL): URL {
  // github.com/owner/repo/blob/branch/path.pdf → raw.githubusercontent.com/owner/repo/branch/path.pdf
  if (url.hostname === 'github.com') {
    const match = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.pathname);
    if (match) return new URL(`https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`);
  }
  // Dropbox share links show a preview page unless dl=1.
  if (url.hostname === 'www.dropbox.com' || url.hostname === 'dropbox.com') {
    const direct = new URL(url);
    direct.searchParams.set('dl', '1');
    return direct;
  }
  return url;
}

function fileNameFrom(url: URL, response: Response): string {
  // Only readable when the site exposes the header, which few do.
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const quoted = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
  let name = quoted ?? url.pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep it as it is.
  }
  name = name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'download';
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

export async function fetchPdfFromUrl(input: string): Promise<File> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("That doesn't look like a link. It should start with https://");
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http and https links can be opened.');
  }
  url = directDownloadUrl(url);

  let response: Response;
  try {
    response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch {
    throw new Error(
      "That site doesn't let other websites download its files, or it couldn't be reached. Download the PDF and add it here instead.",
    );
  }
  if (!response.ok) {
    throw new Error(`The site answered with an error (${response.status}). Check that the link is right.`);
  }

  const length = Number(response.headers.get('Content-Length'));
  if (length > MAX_PDF_SIZE_BYTES) {
    throw new Error(`That PDF is too large. The limit is ${formatFileSize(MAX_PDF_SIZE_BYTES)}.`);
  }

  const blob = await response.blob();
  if (blob.size > MAX_PDF_SIZE_BYTES) {
    throw new Error(`That PDF is too large. The limit is ${formatFileSize(MAX_PDF_SIZE_BYTES)}.`);
  }
  // A link to a web page rather than the file itself is the usual mistake.
  const head = new TextDecoder().decode(await blob.slice(0, 1024).arrayBuffer());
  if (!head.includes('%PDF-')) {
    throw new Error("That link doesn't lead straight to a PDF file. It may be a page that shows the PDF instead.");
  }

  return new File([blob], fileNameFrom(url, response), { type: 'application/pdf', lastModified: Date.now() });
}
