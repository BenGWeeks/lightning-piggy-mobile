/**
 * NFC service for reading and writing NDEF tags.
 *
 * Supports scanning tags containing LNURL-pay/withdraw, lightning invoices,
 * lightning addresses, and Nostr npub identities. Also supports writing
 * npub identities to NFC tags.
 */
import NfcManager, { NfcTech, Ndef, TagEvent } from 'react-native-nfc-manager';
import { Platform, Linking } from 'react-native';

export type NfcTagContent =
  | { type: 'lnurl'; data: string }
  | { type: 'lightning-invoice'; data: string }
  | { type: 'lightning-address'; data: string }
  | { type: 'npub'; data: string }
  | { type: 'unknown'; data: string };

/**
 * Check if the device has NFC hardware.
 */
export async function isNfcSupported(): Promise<boolean> {
  try {
    return await NfcManager.isSupported();
  } catch {
    return false;
  }
}

/**
 * Check if NFC is currently enabled in device settings.
 */
export async function isNfcEnabled(): Promise<boolean> {
  try {
    return await NfcManager.isEnabled();
  } catch {
    return false;
  }
}

/**
 * Open the device NFC settings screen.
 * On Android, opens NFC settings directly.
 * On iOS, opens general Settings (iOS doesn't allow deep-linking to NFC settings).
 */
export function openNfcSettings(): void {
  if (Platform.OS === 'android') {
    NfcManager.goToNfcSetting();
  } else {
    Linking.openSettings();
  }
}

// Track whether NfcManager.start() has resolved this session. Each
// public NFC operation lazily ensures init via `ensureNfcStarted()` so
// callers don't have to remember to bootstrap (and an early-fail
// device that returns false on first attempt won't spam crashes — the
// flag stays false and subsequent ops just fail through their own
// try/catch). Call `initNfc()` at app startup if you want to warm
// the connection before the first user action.
let nfcStarted = false;
async function ensureNfcStarted(): Promise<boolean> {
  if (nfcStarted) return true;
  try {
    await NfcManager.start();
    nfcStarted = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize the NFC manager. Optional — `writeNpubToTag` and the
 * other NFC ops auto-init on first use via the same underlying
 * `ensureNfcStarted()`. Call this from app startup if you want to
 * warm the connection before the first user action (saves ~50ms on
 * first NFC sheet open).
 */
export async function initNfc(): Promise<boolean> {
  return ensureNfcStarted();
}

/**
 * Clean up NFC manager resources.
 */
export function cleanupNfc(): void {
  NfcManager.unregisterTagEvent().catch(() => {});
}

/**
 * Extract text content from an NDEF tag's records.
 */
function extractNdefText(tag: TagEvent): string | null {
  const ndefRecords = tag.ndefMessage;
  if (!ndefRecords || ndefRecords.length === 0) return null;

  for (const record of ndefRecords) {
    // TNF 0x01 = Well-Known, RTD "U" = URI, RTD "T" = Text
    const tnf = record.tnf;
    const payload = record.payload;

    if (!payload || payload.length === 0) continue;

    if (tnf === 1) {
      // Well-Known type
      const typeArr = record.type;
      const typeStr =
        typeof typeArr === 'string' ? typeArr : String.fromCharCode(...(typeArr as number[]));

      if (typeStr === 'U') {
        // URI record: first byte is URI identifier code
        const bytes = new Uint8Array(payload as number[]);
        const decoded = Ndef.uri.decodePayload(bytes as unknown as Uint8Array);
        if (decoded) return decoded;
      }

      if (typeStr === 'T') {
        // Text record: first byte is status byte (encoding + language length)
        const bytes = new Uint8Array(payload as number[]);
        const decoded = Ndef.text.decodePayload(bytes as unknown as Uint8Array);
        if (decoded) return decoded;
      }
    }

    if (tnf === 3) {
      // Absolute URI
      const uri = String.fromCharCode(...payload);
      if (uri) return uri;
    }

    // Try raw payload as string fallback
    try {
      const raw = String.fromCharCode(...payload);
      if (raw && raw.length > 0) return raw;
    } catch {
      // ignore decode errors
    }
  }

  return null;
}

function isLightningInvoice(input: string): boolean {
  const lower = input.toLowerCase();
  return (
    lower.startsWith('lnbc') ||
    lower.startsWith('lntb') ||
    lower.startsWith('lnts') ||
    lower.startsWith('lnbs')
  );
}

function isLightningAddress(input: string): boolean {
  return /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(input);
}

/**
 * Parse raw text from an NFC tag into typed content.
 */
export function parseNfcContent(raw: string): NfcTagContent {
  let input = raw.trim();

  // Strip lightning: prefix
  if (input.toLowerCase().startsWith('lightning:')) {
    input = input.substring(10);
  }

  // LNURL (bech32-encoded, starts with lnurl1)
  if (input.toLowerCase().startsWith('lnurl1')) {
    return { type: 'lnurl', data: input };
  }

  // Lightning invoice (bolt11)
  if (isLightningInvoice(input)) {
    return { type: 'lightning-invoice', data: input };
  }

  // Lightning address (user@domain)
  if (isLightningAddress(input)) {
    return { type: 'lightning-address', data: input };
  }

  // Nostr npub (with or without nostr: prefix)
  if (input.toLowerCase().startsWith('nostr:npub1')) {
    return { type: 'npub', data: input.substring(6) };
  }
  if (input.toLowerCase().startsWith('npub1')) {
    return { type: 'npub', data: input };
  }

  return { type: 'unknown', data: input };
}

/**
 * Start an NFC scan session. Returns parsed tag content.
 * The caller should handle the returned content type appropriately.
 */
export async function scanNfcTag(): Promise<NfcTagContent> {
  try {
    if (!(await ensureNfcStarted())) {
      throw new Error('NFC unavailable on this device');
    }
    await NfcManager.requestTechnology(NfcTech.Ndef);
    const tag = await NfcManager.getTag();

    if (!tag) {
      throw new Error('No tag detected');
    }

    const text = extractNdefText(tag);
    if (!text) {
      throw new Error('This NFC tag does not contain readable data.');
    }

    return parseNfcContent(text);
  } finally {
    NfcManager.cancelTechnologyRequest().catch(() => {});
  }
}

/**
 * Write an npub to an NFC tag as an NDEF URI record.
 * Format: nostr:npub1...
 *
 * @param npub - The npub string to write
 * @param onTagDetected - Optional callback fired when a tag is detected (before write)
 */
export async function writeNpubToTag(npub: string, onTagDetected?: () => void): Promise<void> {
  if (!npub.startsWith('npub1')) {
    throw new Error('Invalid npub format');
  }

  const uri = `nostr:${npub}`;

  try {
    if (!(await ensureNfcStarted())) {
      throw new Error('NFC unavailable on this device');
    }
    await NfcManager.requestTechnology(NfcTech.Ndef);

    const tag = await NfcManager.getTag();
    if (!tag) {
      throw new Error('No tag detected');
    }

    // Notify caller that tag was detected (writing begins)
    onTagDetected?.();

    // Build NDEF message with a URI record
    // Since "nostr:" is not in the standard NFC URI prefix table,
    // we use prefix code 0x00 (no prefix) and include the full URI
    const bytes = Ndef.encodeMessage([Ndef.uriRecord(uri)]);

    if (!bytes) {
      throw new Error('Failed to encode NDEF message');
    }

    await NfcManager.ndefHandler.writeNdefMessage(bytes);
  } finally {
    NfcManager.cancelTechnologyRequest().catch(() => {});
  }
}

/**
 * Write an LNURL string to an NFC tag as an NDEF URI record. Used by
 * the Hunt-hider flow (#468) so the hider can stash a Piggy on a
 * physical token. The URI is `lightning:LNURL1...` so any LNURL-aware
 * wallet (Lightning Piggy, Wallet of Satoshi, Phoenix, Zeus, …) opens
 * on tap.
 *
 * @param lnurl - bech32-encoded `lnurl1...` (case-insensitive) or any
 *   other form the user pasted; we only enforce that the LNURL itself
 *   is non-empty. Use `decodeLnurlWithdraw` from
 *   `lnurlWithdrawService.ts` upstream if you want to validate the
 *   shape before writing.
 * @param onTagDetected - Optional callback fired the moment a tag is
 *   detected (just before write). Mirrors `writeNpubToTag`.
 */
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
type TagFamily = 'ntag-21x' | 'mifare-ultralight' | 'mifare-classic' | 'unknown';

const inferTagFamily = (tag: { techTypes?: string[]; type?: string } | null): TagFamily => {
  if (!tag) return 'unknown';
  const tech = (tag.techTypes ?? []).map((t) => t.toLowerCase());
  if (tech.includes('android.nfc.tech.mifareclassic')) return 'mifare-classic';
  if (tech.includes('android.nfc.tech.mifareultralight')) return 'mifare-ultralight';
  // NTAG21x exposes NfcA + Ndef but no Mifare tech — distinguish from
  // generic NfcA by also requiring Ndef support.
  if (tech.includes('android.nfc.tech.ndef') && tech.includes('android.nfc.tech.nfca')) {
    return 'ntag-21x';
  }
  return 'unknown';
};

export type WriteLnurlResult = {
  family: TagFamily;
  locked: boolean;
};

export async function writeLnurlToTag(
  lnurl: string,
  onTagDetected?: () => void,
): Promise<WriteLnurlResult> {
  const trimmed = lnurl.trim();
  if (!trimmed) {
    throw new Error('Empty LNURL — paste or scan one first');
  }

  // The `lightning:` prefix makes Android's NDEF intent system route
  // the tap to whichever LNURL-aware wallet the user has installed,
  // not just Lightning Piggy. We accept only LNURL-withdraw forms:
  // bech32 `lnurl1…`, LUD-17 `lnurlw://…` / `lnurl://…`, and inputs
  // already wrapped in `lightning:`. Raw https URLs are rejected
  // explicitly — writing `lightning:https://…` to a tag produces a
  // payload most LN wallets can't interpret (see Copilot review on
  // PR #488). The hider can paste the bech32 or `lnurlw://…` form
  // of their endpoint instead. Case handling:
  // - Already prefixed → use as-is.
  // - bech32 (`lnurl1…` / `LNURL1…`) → uppercase is conventional on
  //   tags + QR codes for OCR / scanner robustness; bech32 itself is
  //   case-insensitive so this is information-preserving.
  // - LUD-17 (`lnurlw://…`, `lnurl://…`) → preserve case. The path
  //   component is generally case-sensitive (LNbits for example uses
  //   base58-style segment ids that case-uppercasing would break).
  const isLightningPrefixed = /^lightning:/i.test(trimmed);
  const isBech32 = /^lnurl1/i.test(trimmed);
  const isLud17 = /^lnurlw:\/\//i.test(trimmed) || /^lnurl:\/\//i.test(trimmed);
  if (!isLightningPrefixed && !isBech32 && !isLud17) {
    throw new Error(
      "That doesn't look like an LNURL-withdraw. Paste the `lnurl1…` bech32 form or the `lnurlw://…` URL your wallet gives you.",
    );
  }
  const uri = isLightningPrefixed
    ? trimmed
    : isBech32
      ? `lightning:${trimmed.toUpperCase()}`
      : `lightning:${trimmed}`;

  try {
    if (!(await ensureNfcStarted())) {
      throw new Error('NFC unavailable on this device');
    }
    await NfcManager.requestTechnology(NfcTech.Ndef);

    const tag = await NfcManager.getTag();
    if (!tag) {
      throw new Error('No tag detected');
    }

    const family = inferTagFamily(tag as { techTypes?: string[]; type?: string });
    if (family === 'mifare-classic') {
      throw new Error(
        "Mifare Classic tags can't be permanently locked — use an NTAG213/215/216 or Mifare Ultralight C chip so others can't overwrite this Piglet.",
      );
    }
    if (family === 'unknown') {
      throw new Error(
        'Unrecognised tag type. Lightning Piggy supports NTAG213/215/216 and Mifare Ultralight C.',
      );
    }

    onTagDetected?.();

    const bytes = Ndef.encodeMessage([Ndef.uriRecord(uri)]);
    if (!bytes) {
      throw new Error('Failed to encode NDEF message');
    }

    await NfcManager.ndefHandler.writeNdefMessage(bytes);

    // Permanently lock the NDEF area so a passer-by can't overwrite
    // this Piglet with a phishing / lure URL. `makeReadOnly` writes
    // the dynamic lock bytes on NTAG21x + Mifare Ultralight C; the
    // operation is irreversible by design.
    let locked = false;
    try {
      // The react-native-nfc-manager API exposes makeReadOnly through
      // the Android NDEF handler. Use a defensive `any` cast because
      // the typings on some versions omit the method even though the
      // native impl is present (issue revolutionsystems/.../#1212).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = NfcManager.ndefHandler as any;
      if (typeof handler.makeReadOnly === 'function') {
        const ok = await handler.makeReadOnly();
        locked = ok !== false;
      }
    } catch {
      // Lock failure is non-fatal — the data is written. Surface via
      // `locked: false` so the UI can warn the user that the tag is
      // still re-writeable and recommend using an NTAG21x chip.
    }

    return { family, locked };
  } finally {
    NfcManager.cancelTechnologyRequest().catch(() => {});
  }
}

/**
 * Cancel any ongoing NFC operation.
 */
export function cancelNfcOperation(): void {
  NfcManager.cancelTechnologyRequest().catch(() => {});
  NfcManager.unregisterTagEvent().catch(() => {});
}
