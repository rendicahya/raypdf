import { PDFDocument } from '@cantoo/pdf-lib';
import { loadPdf } from './loader';

type LoadOptions = NonNullable<Parameters<typeof PDFDocument.load>[1]>;

/**
 * Loads a PDF for editing with pdf-lib. A file that opens without a password
 * but has its permissions locked (copying, printing, …) is still encrypted,
 * and pdf-lib refuses to edit it; the empty password decrypts it, so it can
 * be edited and is saved without the lock. Ignored for unencrypted files.
 */
export function loadEditablePdf(bytes: ArrayBuffer | Uint8Array, options: LoadOptions = {}): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ...options, password: '' });
}

/**
 * Returns a copy of a password-protected PDF that opens without one. pdf.js
 * checks the password first (it throws a PasswordException for a wrong one);
 * pdf-lib then writes the decrypted copy, which is opened once more to make
 * sure it really is readable.
 */
export async function unlockPdf(file: File, password: string): Promise<File> {
  const check = await loadPdf(file, password);
  await check.destroy();

  let unlocked: File;
  try {
    const pdfDoc = await PDFDocument.load(await file.arrayBuffer(), { password, updateMetadata: false });
    const bytes = await pdfDoc.save({ updateFieldAppearances: false });
    unlocked = new File([bytes as BlobPart], file.name, { type: 'application/pdf', lastModified: file.lastModified });
    const reopened = await loadPdf(unlocked);
    await reopened.destroy();
  } catch {
    throw new Error("The password is right, but this file's encryption can't be removed here.");
  }
  return unlocked;
}

/**
 * A random owner password, discarded immediately after use. Encrypting needs
 * one, but when copying is locked nobody should be able to lift the lock,
 * including RayPDF, so it is never stored.
 */
function randomOwnerPassword(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface SaveProtection {
  /** Lock text and content copying. */
  lockCopying?: boolean;
  /** Password needed to open the saved file, if any. */
  password?: string;
}

export function hasProtection(protection: SaveProtection): boolean {
  return !!protection.lockCopying || !!protection.password;
}

/**
 * Encrypts a document with a password to open it and/or with copying locked.
 * Applied as the very last step before saving: an encrypted document can't
 * be edited further. Everything other than copying stays allowed (printing,
 * form filling, annotating), since an unlisted permission is denied.
 */
export function applyProtection(pdfDoc: PDFDocument, protection: SaveProtection): void {
  if (!hasProtection(protection)) return;
  const { lockCopying = false, password } = protection;
  pdfDoc.encrypt({
    userPassword: password || undefined,
    // Without the copy lock, the open password grants every right; with it,
    // nobody holds the owner password, so the lock can't be lifted.
    ownerPassword: password && !lockCopying ? password : randomOwnerPassword(),
    permissions: {
      printing: 'highResolution',
      modifying: true,
      copying: !lockCopying,
      annotating: true,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: true,
    },
  });
}
