// Shared NFC reader-mode constants, tag-family inference, and the
// write-result shape. Lives in its own module so both `nfcService.ts`
// and `ntagLock.ts` can import these without a circular dependency
// (ntagLock used to back-import from nfcService while nfcService imports
// the lock helpers from ntagLock).
import { NfcAdapter } from 'react-native-nfc-manager';

// Reader-mode options for every `requestTechnology` call. On Android this
// routes the tag through `enableReaderMode` instead of foreground
// dispatch, so the OS never hands the tag to another app — without it, a
// tag that already holds a `nostr:` / `lightning:` URI launches whatever
// app handles that scheme the moment it's detected, hijacking our
// read/write session. iOS ignores these fields.
export const READER_MODE_OPTS = {
  isReaderModeEnabled: true,
  readerModeFlags:
    NfcAdapter.FLAG_READER_NFC_A |
    NfcAdapter.FLAG_READER_NFC_B |
    NfcAdapter.FLAG_READER_NFC_F |
    NfcAdapter.FLAG_READER_NFC_V |
    NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS,
};

/**
 * Tag-type identification used by `writeLnurlToTag` to decide whether
 * we can lock the tag (NDEF make-read-only) after writing the LNURL.
 * Locking matters because a Piglet's NDEF record is a bearer URL — if
 * a passer-by can overwrite the tag, they can repoint a "Piglet" to a
 * phishing LNURL or, worse, a lure address. Locking the NDEF area
 * after write means re-flashing is impossible without physical chip
 * tampering.
 *
 * Supported families (Android, via react-native-nfc-manager):
 *   - **NTAG213 / NTAG215 / NTAG216** — NXP NFC Forum Type 2.
 *     Lockable via `ndefHandler.makeReadOnly()` which writes the
 *     dynamic lock bytes. Recommended chip for a Piglet.
 *   - **Mifare Ultralight C (MF0ICU2)** — also Type 2, lockable.
 *   - **Mifare Classic 1K / 4K** — NFC Forum Type 1, NDEF is layered
 *     over Crypto1 sectors with per-sector keys. We can't permanently
 *     lock an NDEF area on Classic without burning the sector keys,
 *     which other readers then can't authenticate to read either.
 *     Rejected with a friendly error so the user picks a different
 *     chip.
 *
 * `tech_types` on Android comes back as a list like
 * `["android.nfc.tech.Ndef", "android.nfc.tech.NfcA",
 *   "android.nfc.tech.MifareUltralight"]`; we infer the family from
 * those plus the `type` heuristic the platform exposes.
 */
export type TagFamily =
  | 'ntag-21x'
  | 'ntag-424'
  | 'mifare-ultralight'
  | 'mifare-classic'
  | 'unknown';

export const inferTagFamily = (tag: { techTypes?: string[]; type?: string } | null): TagFamily => {
  if (!tag) return 'unknown';
  const tech = (tag.techTypes ?? []).map((t) => t.toLowerCase());
  if (tech.includes('android.nfc.tech.mifareclassic')) return 'mifare-classic';
  if (tech.includes('android.nfc.tech.mifareultralight')) return 'mifare-ultralight';
  // NTAG424 (DNA) exposes IsoDep + Ndef + NfcA. The IsoDep tech is the
  // marker — NTAG21x doesn't expose it. NTAG424 has 416 B of NDEF user
  // memory (comfortably fits the multi-record Hunt payload) but uses
  // AES-key-based file access for write protection rather than the
  // one-way lock bit `makeReadOnly()` flips on NTAG21x / Ultralight C.
  // The write succeeds; locking requires a DESFire APDU sequence we
  // don't yet ship — caller surfaces `locked: false` so the UI warns.
  if (tech.includes('android.nfc.tech.isodep') && tech.includes('android.nfc.tech.ndef')) {
    return 'ntag-424';
  }
  // NTAG21x exposes NfcA + Ndef but no Mifare tech — distinguish from
  // generic NfcA by also requiring Ndef support.
  if (tech.includes('android.nfc.tech.ndef') && tech.includes('android.nfc.tech.nfca')) {
    return 'ntag-21x';
  }
  return 'unknown';
};

export type WriteLnurlResult = {
  family: TagFamily;
  // True when the tag came out of the write session protected against
  // subsequent rewrites. For NTAG21x via this service that means a
  // reversible PWD/PACK lock the hider can later undo via the unlock
  // flow on step 6 of the wizard. `false` means the data is on the
  // tag but the chip will still accept overwrites from any NFC
  // writer (callers opt in via `lockTag: true` on
  // `WriteHuntTagOptions` / `WriteLnurlOptions`).
  locked: boolean;
  // Set on the reversible-lock path (caller opted in via
  // `lockTag: true`). The caller persists these alongside the cache
  // record so the hider can surface the PIN later and authenticate
  // the unlock flow. Issue #567.
  lock?: {
    pwdHex: string;
    packHex: string;
    pin: string;
    tagUid: string;
  };
};
