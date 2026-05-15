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
type TagFamily =
  | 'ntag-21x'
  | 'ntag-424'
  | 'mifare-ultralight'
  | 'mifare-classic'
  | 'unknown';

const inferTagFamily = (tag: { techTypes?: string[]; type?: string } | null): TagFamily => {
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
const NTAG_424_USABLE_BYTES = 416;

// Map a detected tag family to its usable-NDEF capacity (Android only;
// iOS reports 'unknown' and skips the size check). The 21x family
// returns null intentionally — react-native-nfc-manager doesn't expose
// enough metadata to distinguish 213 from 215 from 216 at detect time,
// so we trust the chip's own size rejection at writeNdefMessage rather
// than pre-blocking a 215 / 216 user with the 213 ceiling. NTAG424 has
// a fixed 416-byte usable area so it's safe to pre-check.
const usableBytesFor = (family: TagFamily): number | null => {
  switch (family) {
    case 'ntag-424':
      return NTAG_424_USABLE_BYTES;
    default:
      return null;
  }
};

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
  // Note: the size check is deferred until AFTER tag detection (below)
  // so a user with a 215 / 216 / 424 isn't pre-blocked by NTAG213's
  // 140-byte ceiling on a payload their actual chip can fit. Pre-fix
  // we threw here unconditionally and the user saw "Write failed"
  // before they'd even tapped the tag (#73 follow-up).
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
        "Mifare Classic tags can't be permanently locked — use an NTAG215 / 216 chip so others can't overwrite this Piglet.",
      );
    }
    if (isAndroid && family === 'unknown') {
      throw new Error(
        'Unrecognised tag type. Lightning Piggy supports NTAG213 / 215 / 216, NTAG424, and Mifare Ultralight C.',
      );
    }
    // Post-detection capacity check — guards against the chip silently
    // truncating the write. 213 maxes out at 140 usable bytes; 215/216
    // / 424 have plenty of headroom for the multi-record payload.
    const cap = isAndroid ? usableBytesFor(family) : null;
    if (cap !== null && bytes.length > cap) {
      throw new Error(
        `Tag payload is ${bytes.length} bytes — this ${family.toUpperCase()} only fits ${cap}. Use an NTAG215 / 216 sticker (504–888 bytes).`,
      );
    }
    opts.onTagDetected?.();
    console.log(`[NFC] tag detected — family=${family} — writing ${bytes.length} bytes…`);
    try {
      await NfcManager.ndefHandler.writeNdefMessage(bytes);
    } catch (writeErr) {
      // NTAG424's NDEF file is gated by AES-key authentication on
      // writes — plain `writeNdefMessage` fails with `java.io.IOException`
      // on a factory-default chip. Full DESFire support is tracked in
      // GH #558; until then surface a clear "use 215/216" prompt so the
      // user doesn't think the app is broken.
      if (family === 'ntag-424') {
        throw new Error(
          "NTAG424 needs AES-key authentication which isn't supported yet (GH #558). Use an NTAG215 / 216 sticker for now.",
        );
      }
      throw writeErr;
    }
    console.log('[NFC] write OK');
    // Lock the NDEF area (Android NTAG21x / Ultralight C) so a passer-by
    // can't overwrite the tag with a phishing payload. iOS has no
    // equivalent API — we skip and report `locked: false`. Same shape
    // as the pre-existing writeLnurlToTag flow below.
    let locked = false;
    if (isAndroid && family !== 'ntag-424') {
      // NTAG21x / Ultralight C share the one-shot `makeReadOnly` lock
      // bit. NTAG424 doesn't — its locking model is AES-key file
      // access. Skip the call (it'd throw) and report locked: false
      // so the UI surfaces the "tag is still re-writeable" warning.
      // Full NTAG424 lock implementation tracked separately.
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
    } else if (family === 'ntag-424') {
      console.log('[NFC] NTAG424 — skipping makeReadOnly (uses key-based file access)');
    }
    console.log(`[NFC] writeHuntTagToTag done — family=${family} locked=${locked}`);
    return { family, locked };
  } finally {
    NfcManager.cancelTechnologyRequest().catch(() => {});
  }
}

/**
 * Parsed payload of a Hide-a-Piglet NFC tag. Mirror of `HuntTagPayload`
 * on the writer side: `lightningpiggy://hunt/<coord>`, `nostr:naddr1…`,
 * and optionally `lightning:lnurl1…`. The reader returns every record it
 * finds — the caller decides which fields are mandatory for the flow
 * (e.g. claim flow requires `lnurl`, deep-link routing only needs `lp`).
 */
export interface HuntTagReadResult {
  /** The lightningpiggy://hunt/<coord> deep link (record 1). */
  lpUrl: string | null;
  /** Derived `<coord>` portion of the lightningpiggy URL — convenience
   * for callers that want to verify the tag matches the cache currently
   * on screen before accepting the claim. */
  coord: string | null;
  /** nostr:naddr1… reference (record 2). */
  nostrUri: string | null;
  /** lightning:lnurl1… bearer-token URI (record 3, optional). */
  lightningUri: string | null;
  /** Bare LNURL (with the `lightning:` scheme stripped). */
  lnurl: string | null;
}

interface ReadHuntTagOpts {
  /** Fires once a tag is in range, before record extraction. */
  onTagDetected?: () => void;
}

// Walk every NDEF record on the tag and bucket URIs by their scheme so
// the caller can ask "what was on this tag?" without re-implementing
// record decoding. Mirrors `extractNdefText` above but returns ALL URIs
// rather than the first match.
function collectNdefUris(tag: TagEvent): string[] {
  const out: string[] = [];
  const ndefRecords = tag.ndefMessage;
  if (!ndefRecords || ndefRecords.length === 0) return out;
  for (const record of ndefRecords) {
    const tnf = record.tnf;
    const payload = record.payload;
    if (!payload || payload.length === 0) continue;
    if (tnf === 1) {
      const typeArr = record.type;
      const typeStr =
        typeof typeArr === 'string' ? typeArr : String.fromCharCode(...(typeArr as number[]));
      if (typeStr === 'U') {
        const bytes = new Uint8Array(payload as number[]);
        const decoded = Ndef.uri.decodePayload(bytes as unknown as Uint8Array);
        if (decoded) out.push(decoded);
      }
    } else if (tnf === 3) {
      // Absolute URI record (less common but spec-allowed).
      out.push(String.fromCharCode(...payload));
    }
  }
  return out;
}

/**
 * Open a foreground NFC reader session and parse the next tag held to
 * the phone as a Hide-a-Piglet payload. Used by the finder claim flow
 * (HuntPiggyDetailScreen → NfcReadSheet) to extract the LNURL bearer
 * token from record 3 of a Piglet tag. The LNURL is never on the public
 * Nostr listing — it ONLY lives on the tag — so a tap is the only way
 * to claim.
 */
export async function readHuntTagPayload(
  opts: ReadHuntTagOpts = {},
): Promise<HuntTagReadResult> {
  try {
    if (!(await ensureNfcStarted())) {
      throw new Error('NFC unavailable on this device');
    }
    await NfcManager.requestTechnology(NfcTech.Ndef, READER_MODE_OPTS);
    const tag = await NfcManager.getTag();
    if (!tag) throw new Error('No tag detected');
    opts.onTagDetected?.();
    const uris = collectNdefUris(tag);
    console.log(`[NFC] readHuntTagPayload: ${uris.length} URIs on tag`);
    let lpUrl: string | null = null;
    let nostrUri: string | null = null;
    let lightningUri: string | null = null;
    for (const u of uris) {
      const lower = u.toLowerCase();
      if (!lpUrl && lower.startsWith('lightningpiggy://')) lpUrl = u;
      else if (!nostrUri && lower.startsWith('nostr:')) nostrUri = u;
      else if (!lightningUri && lower.startsWith('lightning:')) lightningUri = u;
    }
    // Derive the bare coord from the LP URL — strips both
    // `lightningpiggy://hunt/` and any optional query string.
    let coord: string | null = null;
    if (lpUrl) {
      const m = lpUrl.match(/^lightningpiggy:\/\/hunt\/([^?#]+)/i);
      if (m) coord = decodeURIComponent(m[1]);
    }
    const lnurl = lightningUri ? lightningUri.replace(/^lightning:/i, '').trim() : null;
    return { lpUrl, coord, nostrUri, lightningUri, lnurl };
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
