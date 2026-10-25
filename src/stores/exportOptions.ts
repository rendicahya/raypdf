import { writable, get } from 'svelte/store';
import { persistedWritable } from '../lib/utils/persist';
import type { SaveProtection } from '../lib/pdf/password';

/**
 * Whether to strip embedded JavaScript/auto-run actions carried over from
 * the source PDF at export time. Opt-in (see `lib/pdf/sanitize.ts`) since it
 * can drop legitimate form behavior — persisted like the watermark
 * preferences so the choice doesn't reset every session.
 */
export const stripEmbeddedScripts = persistedWritable<boolean>('stripEmbeddedScripts', false);

/**
 * Whether to lock the exported PDF's copy/extract permission at export time
 * (see `applyProtection` in `lib/pdf/password.ts`). Opt-in and persisted
 * like the script-stripping preference above.
 */
export const securePdf = persistedWritable<boolean>('securePdf', false);

/**
 * Whether saved PDFs need a password to open, and that password. Neither is
 * persisted: the password is kept in memory for this visit only, and the
 * switch resets with it so a later visit never saves with an empty one.
 */
export const passwordProtect = writable(false);
export const savePassword = writable('');

/** What every save applies; throws if protection is on without a password. */
export function currentSaveProtection(): SaveProtection {
  const protect = get(passwordProtect);
  const password = get(savePassword);
  if (protect && !password) {
    throw new Error('Enter a password for the saved PDF, or turn off "Require a password to open".');
  }
  return { lockCopying: get(securePdf), password: protect ? password : undefined };
}
