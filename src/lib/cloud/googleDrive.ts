// Open files from Google Drive with Google's own file picker.
//
// Nothing here runs until the user asks for Drive: Google's scripts are
// loaded on first use (`prepareDrive` starts that on hover, so the sign-in
// popup still opens within the click's user activation). The access token
// uses the `drive.file` scope, which only reaches the files the user picks,
// and lives in memory only. Files are downloaded straight from Google into
// the browser; there is no RayPDF server in between.

import { formatFileSize, MAX_PDF_SIZE_BYTES } from '../utils/fileValidation';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
// The Cloud project number. The picker needs it so the files picked are
// granted to this app under `drive.file`.
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined;

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const MIME_TYPES = 'application/pdf,text/markdown,text/x-markdown';
const ACCEPTED_NAME = /\.(pdf|md|markdown)$/i;

/** Whether this build has Google credentials; the Drive buttons are hidden otherwise. */
export const isDriveConfigured = !!(CLIENT_ID && API_KEY && APP_ID);

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const gapi: any;
declare const google: any;

const scripts = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  let loading = scripts.get(src);
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => {
        el.remove();
        scripts.delete(src);
        reject(new Error('Could not reach Google Drive. Check your connection and try again.'));
      };
      document.head.appendChild(el);
    });
    scripts.set(src, loading);
  }
  return loading;
}

let ready: Promise<void> | null = null;

/** Loads Google's sign-in and picker scripts. Safe to call repeatedly. */
export function prepareDrive(): Promise<void> {
  if (!isDriveConfigured) return Promise.reject(new Error('Google Drive is not set up in this build.'));
  if (!ready) {
    ready = Promise.all([
      loadScript('https://accounts.google.com/gsi/client'),
      loadScript('https://apis.google.com/js/api.js').then(
        () =>
          new Promise<void>((resolve, reject) =>
            gapi.load('picker', {
              callback: () => resolve(),
              onerror: () => reject(new Error('Could not load the Google Drive picker.')),
            }),
          ),
      ),
    ]).then(() => undefined);
    ready.catch(() => (ready = null));
  }
  return ready;
}

let token: { value: string; expires: number } | null = null;
let tokenClient: any = null;
let pendingToken: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

function getToken(): Promise<string> {
  if (token && Date.now() < token.expires) return Promise.resolve(token.value);

  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (response: any) => {
        const pending = pendingToken;
        pendingToken = null;
        if (!pending) return;
        if (response.error || !response.access_token) {
          pending.reject(new Error('Google sign-in did not finish.'));
          return;
        }
        // A minute's margin so a token never expires mid-download.
        token = {
          value: response.access_token,
          expires: Date.now() + (Number(response.expires_in) - 60) * 1000,
        };
        pending.resolve(token.value);
      },
      error_callback: (err: any) => {
        const pending = pendingToken;
        pendingToken = null;
        pending?.reject(
          new Error(
            err?.type === 'popup_failed_to_open'
              ? 'The Google sign-in window was blocked. Allow pop-ups for this site and try again.'
              : 'Google sign-in was closed before it finished.',
          ),
        );
      },
    });
  }

  return new Promise<string>((resolve, reject) => {
    pendingToken?.reject(new Error('Google sign-in was restarted.'));
    pendingToken = { resolve, reject };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

interface PickedDoc {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  lastEditedUtc?: number;
}

function showPicker(oauthToken: string): Promise<PickedDoc[]> {
  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes(MIME_TYPES)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setEnableDrives(true);

    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(oauthToken)
      .setDeveloperKey(API_KEY)
      .setAppId(APP_ID)
      .setOrigin(window.location.origin)
      .setCallback((data: any) => {
        const action = data[google.picker.Response.ACTION];
        if (action === google.picker.Action.PICKED) {
          const docs: any[] = data[google.picker.Response.DOCUMENTS] ?? [];
          resolve(
            docs.map((d) => ({
              id: d[google.picker.Document.ID],
              name: d[google.picker.Document.NAME],
              mimeType: d[google.picker.Document.MIME_TYPE],
              sizeBytes: d.sizeBytes != null ? Number(d.sizeBytes) : undefined,
              lastEditedUtc: d[google.picker.Document.LAST_EDITED_UTC],
            })),
          );
        } else if (action === google.picker.Action.CANCEL) {
          resolve([]);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

async function download(doc: PickedDoc, oauthToken: string): Promise<File> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}?alt=media&supportsAllDrives=true`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${oauthToken}` } });
  if (response.status === 401) token = null;
  if (!response.ok) throw new Error(`Could not download ${doc.name} from Google Drive.`);
  const blob = await response.blob();
  // A stable lastModified lets picking the same file twice count as a duplicate.
  return new File([blob], doc.name, {
    type: doc.mimeType === 'application/pdf' ? 'application/pdf' : blob.type || doc.mimeType,
    lastModified: doc.lastEditedUtc ?? Date.now(),
  });
}

/**
 * Lets the user sign in to Google (only when needed) and pick PDF or
 * Markdown files, then downloads them. Cancelling returns no files.
 */
export async function pickFromDrive(): Promise<{ files: File[]; messages: string[] }> {
  if (!navigator.onLine) throw new Error('Google Drive needs an internet connection.');
  await prepareDrive();
  const oauthToken = await getToken();
  const picked = await showPicker(oauthToken);

  const messages: string[] = [];
  const wrongType = picked.filter((d) => d.mimeType !== 'application/pdf' && !ACCEPTED_NAME.test(d.name));
  const tooLarge = picked.filter((d) => (d.sizeBytes ?? 0) > MAX_PDF_SIZE_BYTES);
  const wanted = picked.filter((d) => !wrongType.includes(d) && !tooLarge.includes(d));

  if (wrongType.length > 0) messages.push(`Not a PDF or Markdown file: ${wrongType.map((d) => d.name).join(', ')}`);
  if (tooLarge.length > 0) {
    messages.push(`Skipped (over ${formatFileSize(MAX_PDF_SIZE_BYTES)}): ${tooLarge.map((d) => d.name).join(', ')}`);
  }

  const results = await Promise.allSettled(wanted.map((d) => download(d, oauthToken)));
  const files: File[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') files.push(result.value);
    else messages.push((result.reason as Error).message);
  }
  return { files, messages };
}
