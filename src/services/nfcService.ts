/**
 * NFC service for reading and writing NDEF tags.
 *
 * Supports scanning tags containing LNURL-pay/withdraw, lightning invoices,
 * lightning addresses, and Nostr npub identities. Also supports writing
 * npub identities to NFC tags.
 */
import NfcManager, { NfcTech, Ndef, TagEvent, NfcAdapter } from 'react-native-nfc-manager';
import { Platform, Linking } from 'react-native';

// Reader-mode options for every `requestTechnology` call. On Android this
// routes the tag through `enableReaderMode` instead of foreground
// dispatch, so the OS never hands the tag to another app — without it, a
// tag that already holds a `nostr:` / `lightning:` URI launches whatever
// app handles that scheme the moment it's detected, hijacking our
// read/write session. iOS ignores these fields.
const READER_MODE_OPTS = {
  isReaderModeEnabled: true,
  readerModeFlags:
    NfcAdapter.FLAG_READER_NFC_A |
    NfcAdapter.FLAG_READER_NFC_B |
    NfcAdapter.FLAG_READER_NFC_F |
    NfcAdapter.FLAG_READER_NFC_V |
    NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS,
};

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
    await NfcManager.requestTechnology(NfcTech.Ndef, READER_MODE_OPTS);
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
    await NfcManager.requestTechnology(NfcTech.Ndef, READER_MODE_OPTS);

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

/**
 * Write an LNURL string to an NFC tag as an NDEF URI record. Used by
 * the Hunt-hider flow (#468) so the hider can stash a Piggy on a
 * physical token. The URI is `lightning:LNURL1...` so any LNURL-aware
 * wallet (Lightning Piggy, Wallet of Satoshi, Phoenix, Zeus, …) opens
 * on tap.
 *
 * **iOS vs Android**: tag-family inference and `makeReadOnly()` locking
 * are Android-only — `tag.techTypes` is an Android-specific shape and
 * the CoreNFC iOS API doesn't expose an equivalent permanent-lock
 * primitive. On iOS we write the NDEF record and return
 * `{ family: 'unknown', locked: false }`; the UI surfaces the
 * unlocked state so the user can decide whether to deploy that tag.
 *
 * @param lnurl - bech32-encoded `lnurl1...` (case-insensitive) or any
 *   other form the user pasted; we only enforce that the LNURL itself
 *   is non-empty. Use `decodeLnurlWithdraw` from
 *   `lnurlWithdrawService.ts` upstream if you want to validate the
 *   shape before writing.
 * @param onTagDetected - Optional callback fired the moment a tag is
 *   detected (just before write). Mirrors `writeNpubToTag`.
 */
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
    await NfcManager.requestTechnology(NfcTech.Ndef, READER_MODE_OPTS);

    const tag = await NfcManager.getTag();
    if (!tag) {
      throw new Error('No tag detected');
    }

    // Family inference + lock-on-write are Android-only — `techTypes`
    // is Android-specific and CoreNFC has no equivalent permanent-lock
    // primitive. On iOS we write the NDEF record without inspecting
    // the chip family and report `{ family: 'unknown', locked: false }`
    // so the hider knows the tag is still re-writeable (Copilot
    // review #488).
    const isAndroid = Platform.OS === 'android';
    const family = isAndroid
      ? inferTagFamily(tag as { techTypes?: string[]; type?: string })
      : ('unknown' as TagFamily);
    if (isAndroid && family === 'mifare-classic') {
      throw new Error(
        "Mifare Classic tags can't be permanently locked — use an NTAG213/215/216 or Mifare Ultralight C chip so others can't overwrite this Piglet.",
      );
    }
    if (isAndroid && family === 'unknown') {
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
    // operation is irreversible by design. iOS has no equivalent
    // API — we skip the call and report `locked: false`.
    let locked = false;
    if (isAndroid) {
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
    }

    return { family, locked };
  } finally {
    NfcManager.cancelTechnologyRequest().catch(() => {});
  }
}

// NTAG213 is the cheapest commonly-bought NFC sticker. After NDEF
// framing overhead the usable user-data area is ~140 bytes. We check
// the encoded NDEF message length against this floor and surface a
// friendly error before the write so a hider gets a "switch to NTAG215
// for more room" prompt rather than a cryptic NfcManager rejection.
// Larger chips (NTAG215 = 504B usable, NTAG216 = 888B) accept the same
// payload with headroom.
const NTAG_213_USABLE_BYTES = 140;

export interface HuntTagPayload {
  /** Cache coord (`kind:pubkey:d`) — used to build the lightningpiggy://
   * deep link AND the naddr1 reference. */
  coord: string;
  /** Pre-encoded `naddr1...` reference to the kind 37516 listing.
   * Built by the caller via `nip19.naddrEncode(...)`. */
  naddr: string;
  /** Optional LNURL-withdraw bearer. When present, encoded as the
   * trailing record so a generic LN wallet can still claim by tapping
   * the tag if our app isn't installed. When absent, finders only
   * reach the listing — they need to use our app + the in-app claim
   * flow to actually withdraw. */
  lnurl?: string;
}

export interface WriteHuntTagOptions extends HuntTagPayload {
  onTagDetected?: () => void;
}

/**
 * Write a multi-record NDEF message to a Hide-a-Piglet tag, then lock
 * the NDEF area on Android NTAG21x / Ultralight C chips. Record order:
 *
 *   1. `lightningpiggy://hunt/<coord>` — our scheme, registered in the
 *      AndroidManifest, so a tap on the tag opens this app even when
 *      multiple NFC-aware apps are installed.
 *   2. `nostr:naddr1…` — universal reference to the kind 37516 listing.
 *      Lets generic Nostr clients (Damus, Primal, etc.) at least show
 *      the cache metadata if our app isn't installed.
 *   3. (optional) `lightning:LNURL1…` — LNURL-withdraw bearer for
 *      finders without our app. Omitted when the hider chose
 *      "Listing-only" in the wizard.
 *
 * NTAG213 capacity guard: aborts with a friendly error before write if
 * the encoded message exceeds the chip's ~140 byte ceiling. Larger
 * chips (NTAG215 / 216) accept the same payload with headroom.
 */
export async function writeHuntTagToTag(
  opts: WriteHuntTagOptions,
): Promise<WriteLnurlResult> {
  const coord = opts.coord.trim();
  const naddr = opts.naddr.trim();
  const lnurl = opts.lnurl?.trim();
  if (!coord || !naddr) {
    throw new Error('Hunt tag payload requires both coord and naddr');
  }
  // Record 1's base URL. Defaults to the custom-scheme form because
  // that's what the AndroidManifest's intent-filter actually claims
  // today — `lightningpiggy://hunt/<coord>` opens our app on tap.
  // `https://www.lightningpiggy.com/hunt/<coord>` is the better
  // long-term default (works in a browser too, friendlier when our
  // app isn't installed) BUT needs three pieces of infra first:
  //   1. The `/hunt/<coord>` route on the website (cache info +
  //      download link)
  //   2. An https intent-filter + `autoVerify` in the manifest
  //   3. `/.well-known/assetlinks.json` on the domain so Android
  //      App Links verify and bypass the OS chooser
  // Once those land, flip `EXPO_PUBLIC_HUNT_TAG_BASE_URL` in `.env`
  // to `https://www.lightningpiggy.com/hunt/` (with trailing slash).
  // The App.tsx Linking handler already recognises both forms.
  //
  // URI-encode the coord — colons in `kind:pubkey:d` would otherwise
  // be parsed as a port authority.
  const HUNT_TAG_BASE =
    (process.env.EXPO_PUBLIC_HUNT_TAG_BASE_URL ?? 'lightningpiggy://hunt/');
  const lpUri = `${HUNT_TAG_BASE}${encodeURIComponent(coord)}`;
  const nostrUri = naddr.startsWith('nostr:') ? naddr : `nostr:${naddr}`;
  // Bech32 LNURLs are case-insensitive — uppercase is conventional on
  // physical tags + QR for OCR robustness. Pre-existing convention from
  // writeLnurlToTag below; preserved here for the optional LNURL record.
  const ndefRecords = [Ndef.uriRecord(lpUri), Ndef.uriRecord(nostrUri)];
  if (lnurl) {
    const lightningUri = /^lightning:/i.test(lnurl)
      ? lnurl
      : `lightning:${/^lnurl1/i.test(lnurl) ? lnurl.toUpperCase() : lnurl}`;
    ndefRecords.push(Ndef.uriRecord(lightningUri));
  }
  const bytes = Ndef.encodeMessage(ndefRecords);
  if (!bytes) {
    throw new Error('Failed to encode NDEF message');
  }
  // Diagnostic — visible on `adb logcat | grep NFC`. Helps the field
  // tester (Ben on the Pixel) see record count + encoded size at a
  // glance so a write failure can be triaged against the NTAG213
  // ceiling without guesswork.
  console.log(
    `[NFC] writeHuntTagToTag: ${ndefRecords.length} records, ${bytes.length} bytes ` +
      `(records: lp=${lpUri.length} nostr=${nostrUri.length}` +
      (lnurl ? ` lnurl=${(ndefRecords[2] ? lnurl.length : 0)}` : '') +
      ')',
  );
  if (bytes.length > NTAG_213_USABLE_BYTES) {
    // Surface chip-family guidance up front. The user can shorten the
    // cache `d` tag (the only field they control here) or move to a
    // 215/216 chip; both options are friendlier than a write-time
    // rejection from the chip itself.
    throw new Error(
      `Tag payload is ${bytes.length} bytes — NTAG213 only fits ~140. Use a shorter cache name (the d-tag) or an NTAG215 / NTAG216 sticker.`,
    );
  }
  try {
    if (!(await ensureNfcStarted())) {
      throw new Error('NFC unavailable on this device');
    }
    await NfcManager.requestTechnology(NfcTech.Ndef, READER_MODE_OPTS);
    const tag = await NfcManager.getTag();
    if (!tag) {
      throw new Error('No tag detected');
    }
    const isAndroid = Platform.OS === 'android';
    const family = isAndroid
      ? inferTagFamily(tag as { techTypes?: string[]; type?: string })
      : ('unknown' as TagFamily);
    if (isAndroid && family === 'mifare-classic') {
      throw new Error(
        "Mifare Classic tags can't be permanently locked — use an NTAG213/215/216 or Mifare Ultralight C chip so others can't overwrite this Piglet.",
      );
    }
    if (isAndroid && family === 'unknown') {
      throw new Error(
        'Unrecognised tag type. Lightning Piggy supports NTAG213/215/216 and Mifare Ultralight C.',
      );
    }
    opts.onTagDetected?.();
    console.log(`[NFC] tag detected — family=${family} — writing ${bytes.length} bytes…`);
    await NfcManager.ndefHandler.writeNdefMessage(bytes);
    console.log('[NFC] write OK');
    // Lock the NDEF area (Android NTAG21x / Ultralight C) so a passer-by
    // can't overwrite the tag with a phishing payload. iOS has no
    // equivalent API — we skip and report `locked: false`. Same shape
    // as the pre-existing writeLnurlToTag flow below.
    let locked = false;
    if (isAndroid) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = NfcManager.ndefHandler as any;
        if (typeof handler.makeReadOnly === 'function') {
          const ok = await handler.makeReadOnly();
          locked = ok !== false;
        }
      } catch (lockErr) {
        // Lock failure is non-fatal — data is written; surface via
        // `locked: false` so the UI can warn.
        console.warn(`[NFC] makeReadOnly threw: ${(lockErr as Error)?.message ?? lockErr}`);
      }
    }
    console.log(`[NFC] writeHuntTagToTag done — family=${family} locked=${locked}`);
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
