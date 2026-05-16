/**
 * NFC service for reading and writing NDEF tags.
 *
 * Supports scanning tags containing LNURL-pay/withdraw, lightning invoices,
 * lightning addresses, and Nostr npub identities. Also supports writing
 * npub identities to NFC tags.
 */
import NfcManager, { NfcTech, Ndef, TagEvent, NfcAdapter } from 'react-native-nfc-manager';
import { Platform, Linking } from 'react-native';
import {
  buildDisableAuthFrame,
  buildEnableAuthFrame,
  buildGetVersionFrame,
  buildNdefTlvBytes,
  buildPackWriteFrame,
  buildPwdAuthFrame,
  buildPwdWriteFrame,
  buildReadFrame,
  buildSetAccessFrame,
  diagnoseTagLockState,
  familyFromGetVersion,
  generateLockSecrets,
  pagesForFamily,
  packToHex,
  pwdToPin,
  splitIntoPages,
  type NtagFamily,
  type NtagPages,
} from '../utils/nfc/ntag21xLock';

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
type TagFamily = 'ntag-21x' | 'ntag-424' | 'mifare-ultralight' | 'mifare-classic' | 'unknown';

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
  // True when the tag came out of the write session protected against
  // subsequent rewrites. For NTAG21x via this service that means either
  // the legacy one-way OTP lock (`makeReadOnly`, no recovery) or — when
  // the caller opts in — a reversible PWD/PACK lock the hider can later
  // undo from their My-Piglets PIN. `false` means the data is on the
  // tag but the chip will still accept overwrites from any NFC writer.
  locked: boolean;
  // Set on the reversible-lock path (see `lockMode === 'pwd-pack'`). The
  // caller persists these alongside the cache record so the hider can
  // surface the PIN later and authenticate the unlock flow. Issue #567.
  lock?: {
    pwdHex: string;
    packHex: string;
    pin: string;
    tagUid: string;
  };
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
// Options-form to thread the issue-#567 `lockTag` toggle through. The
// legacy two-positional-arg signature is kept as an overload so any
// older call site keeps compiling, but callers that want the reversible
// lock should pass the options form.
export interface WriteLnurlOptions {
  lnurl: string;
  onTagDetected?: () => void;
  lockTag?: boolean;
  existingLock?: { pwdHex: string; packHex: string };
}

export async function writeLnurlToTag(
  opts: WriteLnurlOptions | string,
  legacyOnTagDetected?: () => void,
): Promise<WriteLnurlResult> {
  // Normalise the two signatures into a single options object so the
  // body below only handles one shape.
  const normalised: WriteLnurlOptions =
    typeof opts === 'string' ? { lnurl: opts, onTagDetected: legacyOnTagDetected } : opts;
  const { lnurl, onTagDetected, lockTag = false, existingLock } = normalised;
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

  // Reversible-lock path for single-record LNURL writes (private
  // Piglets that don't have a nostr:naddr to emit). Bridges to the same
  // MifareUltralight write+lock the multi-record `writeHuntTagToTag`
  // uses, so the lock toggle behaves consistently across public AND
  // private hides. Pre-#572 Copilot review the private path silently
  // fell back to the legacy one-way `makeReadOnly` even when the
  // wizard toggle said "Lock the tag — on".
  if (lockTag && Platform.OS === 'android') {
    const bytes = Ndef.encodeMessage([Ndef.uriRecord(uri)]);
    if (!bytes) throw new Error('Failed to encode NDEF message');
    try {
      if (!(await ensureNfcStarted())) throw new Error('NFC unavailable on this device');
      return await writeNdefBytesAndLockAndroid({ onTagDetected, existingLock }, bytes);
    } finally {
      NfcManager.cancelTechnologyRequest().catch(() => {});
    }
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
  // When true (default), the Android NTAG21x write path enables PWD/PACK
  // password protection on the tag using a fresh random 32-bit PWD + 16-
  // bit PACK (NXP AN1303 §7.6). The PIN goes back to the caller via the
  // returned `lock` field; the hider can unlock the tag later via the
  // My-Piglets flow. Set false for the legacy unlocked-write behaviour
  // (rarely useful — passers-by can repoint the tag). Issue #567.
  lockTag?: boolean;
  // Rewrite-aware locked write. When the hider edits an existing Piglet
  // whose tag was locked, the wizard threads the previously-stored PWD
  // + PACK here so the write path can PWD_AUTH the chip before writing
  // the new NDEF payload, then leave AUTH0 in place — the SAME PIN
  // keeps working post-rewrite without the hider tracking a fresh one.
  // Used only on the Android locked-write path; ignored otherwise.
  // Issue #567.
  existingLock?: { pwdHex: string; packHex: string };
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
export async function writeHuntTagToTag(opts: WriteHuntTagOptions): Promise<WriteLnurlResult> {
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
  const HUNT_TAG_BASE = process.env.EXPO_PUBLIC_HUNT_TAG_BASE_URL ?? 'lightningpiggy://hunt/';
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
      (lnurl ? ` lnurl=${ndefRecords[2] ? lnurl.length : 0}` : '') +
      ')',
  );
  // Note: the size check is deferred until AFTER tag detection (below)
  // so a user with a 215 / 216 / 424 isn't pre-blocked by NTAG213's
  // 140-byte ceiling on a payload their actual chip can fit. Pre-fix
  // we threw here unconditionally and the user saw "Write failed"
  // before they'd even tapped the tag (#73 follow-up).
  // Lock toggle — default to the reversible PWD/PACK path on Android.
  // Caller passes `lockTag: false` only when explicitly publishing an
  // unlocked tag (legacy flow / iOS).
  const wantLock = opts.lockTag !== false && Platform.OS === 'android';

  try {
    if (!(await ensureNfcStarted())) {
      throw new Error('NFC unavailable on this device');
    }
    // Android + lock requested → write + password-protect in a single
    // MifareUltralight session so the user only taps once. The
    // MifareUltralight tech exposes both `mifareUltralightWritePage`
    // (for raw page writes) AND `transceive` (for the PWD_AUTH command
    // used by the unlock flow). Going through `NfcTech.Ndef` here would
    // make `transceive` unavailable — the native dispatch (NfcManager.java
    // §transceive switch) has no Ndef case — and the alternative of
    // cancelling Ndef and re-requesting NfcA needs the tag to leave and
    // re-enter the field, which we want to avoid mid-write.
    if (wantLock) {
      return await writeNdefBytesAndLockAndroid(
        { onTagDetected: opts.onTagDetected, existingLock: opts.existingLock },
        bytes,
      );
    }
    // Unlocked path (iOS, or Android with lockTag=false) — original
    // Ndef-tech write. The `locked: false` return is honest: no
    // password set, no OTP lock bit flipped.
    return await writeHuntTagUnlocked(opts, bytes);
  } finally {
    NfcManager.cancelTechnologyRequest().catch(() => {});
  }
}

// Existing Ndef-tech write path, factored out so the lock-toggle
// dispatch in `writeHuntTagToTag` stays readable. Reports `locked: false`
// always — no longer flips the legacy one-way `makeReadOnly` bit, which
// gave hiders no recovery path. Use the locked path (default) to gate
// rewrites without permanently sealing the chip.
async function writeHuntTagUnlocked(
  opts: WriteHuntTagOptions,
  bytes: number[],
): Promise<WriteLnurlResult> {
  await NfcManager.requestTechnology(NfcTech.Ndef, READER_MODE_OPTS);
  const tag = await NfcManager.getTag();
  if (!tag) throw new Error('No tag detected');
  const isAndroid = Platform.OS === 'android';
  const family = isAndroid
    ? inferTagFamily(tag as { techTypes?: string[]; type?: string })
    : ('unknown' as TagFamily);
  if (isAndroid && family === 'mifare-classic') {
    throw new Error(
      "Mifare Classic tags can't be locked — use an NTAG215 / 216 chip so others can't overwrite this Piglet.",
    );
  }
  if (isAndroid && family === 'unknown') {
    throw new Error(
      'Unrecognised tag type. Lightning Piggy supports NTAG213 / 215 / 216, NTAG424, and Mifare Ultralight C.',
    );
  }
  const cap = isAndroid ? usableBytesFor(family) : null;
  if (cap !== null && bytes.length > cap) {
    throw new Error(
      `Tag payload is ${bytes.length} bytes — this ${family.toUpperCase()} only fits ${cap}. Use an NTAG215 / 216 sticker (504–888 bytes).`,
    );
  }
  opts.onTagDetected?.();
  console.log(`[NFC] tag detected — family=${family} — writing ${bytes.length} bytes (unlocked)…`);
  try {
    await NfcManager.ndefHandler.writeNdefMessage(bytes);
  } catch (writeErr) {
    if (family === 'ntag-424') {
      throw new Error(
        "NTAG424 needs AES-key authentication which isn't supported yet (GH #558). Use an NTAG215 / 216 sticker for now.",
      );
    }
    throw writeErr;
  }
  console.log(`[NFC] writeHuntTagUnlocked done — family=${family}`);
  return { family, locked: false };
}

// Android NTAG21x write + reversible PWD/PACK lock under a single
// MifareUltralight tech session. Two sub-paths:
//
//  • Fresh write — generates new PWD/PACK + enables AUTH0=0x04.
//  • Rewrite-aware — when `opts.existingLock` is set, PWD_AUTH with the
//    stored PWD first so the chip will accept user-page writes, then
//    just write the new NDEF data. AUTH0/PWD/PACK stay as they were
//    so the SAME PIN survives the rewrite (issue #567 user request:
//    "if it was locked before, it … locks it again with the same PIN").
//
// The chip's NDEF detection works off the factory CC at page 0x03,
// which we never overwrite — so a finder scanning the locked tag still
// sees a standard NDEF read response with the same three records
// (`lightningpiggy://hunt/...`, `nostr:naddr1...`, optional
// `lightning:lnurl1...`).
// Shared Android NDEF write + reversible PWD/PACK lock. Both
// `writeHuntTagToTag` (multi-record public hide) and `writeLnurlToTag`
// (single-record private hide) route through here so the lock
// behaviour is uniform regardless of payload size. Caller has already
// gone through `ensureNfcStarted()` + owns its own
// `cancelTechnologyRequest` in a finally.
interface LockedWriteOptions {
  onTagDetected?: () => void;
  existingLock?: { pwdHex: string; packHex: string };
}

async function writeNdefBytesAndLockAndroid(
  opts: LockedWriteOptions,
  ndefBytes: number[],
): Promise<WriteLnurlResult> {
  await NfcManager.requestTechnology(NfcTech.MifareUltralight, READER_MODE_OPTS);
  const tag = await NfcManager.getTag();
  if (!tag) throw new Error('No tag detected');
  const techFamily = inferTagFamily(tag as { techTypes?: string[]; type?: string });
  if (techFamily === 'mifare-classic') {
    throw new Error(
      "Mifare Classic tags can't be locked — use an NTAG215 / 216 chip so others can't overwrite this Piglet.",
    );
  }
  if (techFamily === 'ntag-424') {
    throw new Error(
      "NTAG424 doesn't support PWD/PACK locking — use an NTAG215 / 216 sticker (GH #558).",
    );
  }
  // GET_VERSION tells us 213 vs 215 vs 216 — the configuration pages
  // live at different addresses per chip (213: 0x29-0x2C, 215: 0x83-
  // 0x86, 216: 0xE3-0xE6) so we have to know before issuing any
  // PWD/PACK/AUTH0 write. Pre-Copilot-#572-review this hard-coded
  // 215's addresses and would have silently written into user memory
  // on a 216, leaving the chip in an undefined state.
  let chip: NtagFamily;
  try {
    const versionBytes = await NfcManager.nfcAHandler.transceive(buildGetVersionFrame());
    const detected = familyFromGetVersion(versionBytes);
    if (!detected) {
      throw new Error(
        "Couldn't identify the chip from its GET_VERSION reply — use an NTAG215 / 216 sticker.",
      );
    }
    chip = detected;
  } catch (e) {
    throw new Error(`Tag identification (GET_VERSION) failed: ${(e as Error)?.message ?? e}`);
  }
  if (chip === 'ntag-213') {
    throw new Error(
      'NTAG213 only has 144 bytes of user memory — not enough for a Hide-a-Piglet payload. Use an NTAG215 / 216 instead.',
    );
  }
  const pages = pagesForFamily(chip);
  const tagUid = (() => {
    const id = (tag as { id?: string }).id;
    return typeof id === 'string' && id.length > 0 ? id : '';
  })();
  // If the wizard passed in stored secrets for an existing lock,
  // authenticate before the write so user pages accept it. PWD_AUTH
  // failure means the tag isn't actually locked with this PIN — could
  // be a fresh tag, a different tag, or one rewritten by another tool.
  // Surface that clearly so the hider can recover (use a fresh tag,
  // unlock first, etc.).
  let reusedExistingLock: { pwdHex: string; packHex: string } | null = null;
  if (opts.existingLock) {
    const storedPwd = hexBytes(opts.existingLock.pwdHex, 4);
    const expectedPack = hexBytes(opts.existingLock.packHex, 2);
    try {
      const pack = await NfcManager.nfcAHandler.transceive(buildPwdAuthFrame(storedPwd));
      const packMatches =
        pack.length >= 2 && pack[0] === expectedPack[0] && pack[1] === expectedPack[1];
      if (!packMatches) {
        throw new Error("Tag PACK didn't match the stored value — this isn't the tag we locked.");
      }
      reusedExistingLock = { ...opts.existingLock };
      console.log('[NFC] rewrite path — PWD_AUTH OK, reusing existing lock');
    } catch (e) {
      throw new Error(
        `Tag is locked with a different PIN than the one we have stored for this Piglet. ${(e as Error)?.message ?? ''}`.trim(),
      );
    }
  }
  // Build the full byte stream we'll write into user pages: TLV envelope
  // around the NDEF message, then page-aligned.
  const tlvBytes = buildNdefTlvBytes(ndefBytes);
  const tlvPages = splitIntoPages(tlvBytes);
  // Capacity guard — abort BEFORE issuing any writePage if the TLV
  // doesn't fit in the chip's user-memory window. Without this guard
  // an oversize NDEF on a 215 would happily overwrite the dynamic
  // lock / config / PWD pages at 0x82+, leaving the tag bricked. The
  // datasheet's writePage behaviour past the user-memory boundary is
  // chip-specific (some return NAK, others silently write — neither is
  // safe). Copilot #572 review flagged this as a blocking issue.
  const userMemoryPageCount = pages.userPageLast - pages.userPageFirst + 1;
  if (tlvPages.length > userMemoryPageCount) {
    throw new Error(
      `Payload needs ${tlvPages.length * 4} bytes but ${chip.toUpperCase()} only offers ${userMemoryPageCount * 4} bytes of user memory. Use a larger chip (NTAG216 = 888 bytes).`,
    );
  }
  opts.onTagDetected?.();
  console.log(
    `[NFC] locked write — chip=${chip} uid=${tagUid} ndef=${ndefBytes.length}B ` +
      `tlv=${tlvBytes.length}B pages=${tlvPages.length}/${userMemoryPageCount} ` +
      `mode=${reusedExistingLock ? 'rewrite-keep-pin' : 'fresh-lock'}`,
  );
  // Phase 1 — write NDEF data starting at the chip's first user page
  // (0x04 on every NTAG21x). Page-by-page so a mid-stream failure
  // surfaces the offending page index in the error. On failure we
  // also run the lock-status diagnostic so the hider gets a clear
  // "OTP-locked, get a fresh chip" vs "PWD-protected, unlock first"
  // message instead of just "Transceive failed" (Pixel test session).
  for (let i = 0; i < tlvPages.length; i++) {
    const offset = pages.userPageFirst + i;
    try {
      await NfcManager.mifareUltralightHandlerAndroid.mifareUltralightWritePage(
        offset,
        tlvPages[i],
      );
    } catch (e) {
      const raw = `Tag write failed at page 0x${offset.toString(16)} (byte ${i * 4}/${tlvBytes.length}) — ${(e as Error)?.message ?? e}.`;
      const diagnosis = await diagnoseAndExplainLockState(pages).catch(() => null);
      throw new Error(diagnosis ? `${diagnosis}\n\n(${raw})` : raw);
    }
  }
  console.log('[NFC] NDEF user-data write OK');
  // Phase 2a — rewrite path. We already PWD_AUTH'd above, so the chip
  // accepted the user-page writes. PWD/PACK don't need re-writing
  // (they're still on the chip), but we DO re-apply ACCESS + AUTH0
  // idempotently. Pre-#572-review-r2 this branch assumed "the chip is
  // still locked because PWD_AUTH succeeded" — that's not strictly
  // true: AUTH0 can be 0xFF (unlocked) while PWD/PACK remain stored,
  // in which case PWD_AUTH still returns the matching PACK but the
  // tag is wide open. Re-writing CFG_0/CFG_1 here makes the rewrite
  // path idempotently locked regardless of the chip's prior AUTH0
  // state. The same PIN keeps working because we never touched
  // PWD/PACK.
  if (reusedExistingLock) {
    await sendTransceive(buildSetAccessFrame(pages), 'WRITE ACCESS (rewrite)');
    await sendTransceive(buildEnableAuthFrame(pages), 'WRITE AUTH0 (rewrite)');
    return {
      family: techFamily,
      locked: true,
      lock: {
        pwdHex: reusedExistingLock.pwdHex,
        packHex: reusedExistingLock.packHex,
        pin: reusedExistingLock.pwdHex.toUpperCase(),
        tagUid,
      },
    };
  }
  // Phase 2b — fresh-lock path. Set PWD/PACK + flip protection on.
  // Order matters: PWD and PACK first (so the chip stores them), then
  // ACCESS (configures read-still-allowed / write-blocked), then AUTH0
  // LAST — once AUTH0 = 0x04 takes effect, subsequent writes to pages
  // ≥ 4 require PWD_AUTH, including writes to PWD/PACK/CFG pages
  // themselves. Writing AUTH0 before PWD/PACK would lock us out before
  // we can store the password.
  const secrets = generateLockSecrets();
  await sendTransceive(buildPwdWriteFrame(pages, secrets.pwd), 'WRITE PWD');
  await sendTransceive(buildPackWriteFrame(pages, secrets.pack), 'WRITE PACK');
  await sendTransceive(buildSetAccessFrame(pages), 'WRITE ACCESS');
  await sendTransceive(buildEnableAuthFrame(pages), 'WRITE AUTH0');
  const pwdHex = secrets.pwd.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
  const packHex = packToHex(secrets.pack);
  const pin = pwdToPin(secrets.pwd);
  console.log(`[NFC] locked write done — chip=${chip} pin=${pin.slice(0, 2)}******`);
  return {
    family: techFamily,
    locked: true,
    lock: { pwdHex, packHex, pin, tagUid },
  };
}

// Read the chip's lock-status bytes after a writePage failure and
// translate the state into a hider-readable explanation. Three
// states the user might see:
//
//   • OTP-locked: the static/dynamic lock bits at page 0x02 / family-
//     specific dynamic-lock page are set. These are one-way; once
//     flipped the chip is permanently read-only and no software can
//     recover it. Usually a relic of the pre-#567 path that called
//     Ndef.makeReadOnly() after every write — NFC Tools reports this
//     as "Writeable: No". The hider needs a fresh NTAG215.
//   • PWD-protected: AUTH0 ≤ last user page, so the chip is gating
//     writes behind PWD_AUTH. The hider can recover by entering the
//     Edit flow for the Piglet that originally locked this tag and
//     tapping Unlock tag.
//   • Open: no lock detected, the IOException came from elsewhere
//     (tag connection drop, broken antenna pad, mis-detected
//     family, …). Surface the raw transceive error.
//
// Each branch returns the prose; the caller composes it into the
// thrown error so the BrandedAlert / write-sheet error state shows
// it verbatim.
async function diagnoseAndExplainLockState(pages: NtagPages): Promise<string | null> {
  try {
    // READ at page 0x02 returns 16 bytes (pages 0x02-0x05). The
    // static lock bits live in bytes 2-3 of page 0x02.
    const staticRead = await NfcManager.nfcAHandler.transceive(buildReadFrame(0x02));
    if (staticRead.length < 4) return null;
    // READ at the dynamic-lock page (215: 0x82, 216: 0xE2, 213:
    // 0x28). Byte 0 holds the dynamic lock bits.
    const dynamicRead = await NfcManager.nfcAHandler.transceive(
      buildReadFrame(pages.dynamicLockPage),
    );
    if (dynamicRead.length < 1) return null;
    // READ CFG_0 → byte 3 is AUTH0 (first page that requires
    // PWD_AUTH for writes). Pre-set 0xFF (disabled) on a factory
    // chip; PR #567's lock flow sets it to 0x04.
    const cfg0Read = await NfcManager.nfcAHandler.transceive(buildReadFrame(pages.cfg0));
    if (cfg0Read.length < 4) return null;
    const state = diagnoseTagLockState(staticRead.slice(0, 4), dynamicRead[0], cfg0Read[3], pages);
    switch (state.kind) {
      case 'otp-locked':
        return (
          'This tag is permanently locked — its chip-level lock bits have been flipped ' +
          '(usually by an earlier app calling makeReadOnly). No software can rewrite it ' +
          'or undo the lock. Grab a fresh NTAG215 sticker / charm to continue.'
        );
      case 'pwd-protected':
        return (
          "This tag is password-locked by a Lightning Piggy PIN we don't have stored on " +
          `this device (chip AUTH0 = 0x${state.auth0.toString(16).padStart(2, '0').toUpperCase()}). ` +
          'Open the original Piglet from My Piglets, tap Edit, then Unlock tag on the PIN ' +
          'card. After that the chip accepts a fresh write.'
        );
      case 'open':
        return null;
      default:
        return null;
    }
  } catch {
    // READ itself can fail if the tag left the antenna mid-write. In
    // that case the diagnostic adds nothing — fall back to the raw
    // transceive error.
    return null;
  }
}

// Thin alias for `hexToBytes` from the lock module — keeps the calls
// in this file readable without `ntag215Lock.hexToBytes` prefixing.
const hexBytes = (hex: string, len: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  if (out.length !== len) throw new Error(`hex length mismatch: got ${out.length}, want ${len}`);
  return out;
};

// Thin wrapper around `nfcAHandler.transceive` that surfaces the failing
// command name in the error message. The native handler returns
// `transceive fail: ${ex}` on TagLost / IOException; chaining the label
// makes "WRITE AUTH0 failed: TAG_LOST" instantly diagnostic.
async function sendTransceive(frame: number[], label: string): Promise<number[]> {
  try {
    return await NfcManager.nfcAHandler.transceive(frame);
  } catch (e) {
    throw new Error(`${label} failed: ${(e as Error)?.message ?? e}`);
  }
}

/**
 * Disable PWD/PACK protection on a previously-locked NTAG21x. Requires
 * the hider's PIN (the 8-hex-char `pwdHex` originally returned from the
 * lock flow). Performs PWD_AUTH first — if the PIN is wrong the chip
 * returns a NAK and the unlock fails without changing tag state. On
 * success, parks AUTH0 above the last real page so subsequent writes
 * proceed without a password.
 *
 * Android-only — iOS doesn't support raw NTAG21x command transceive in
 * the same library shape (CoreNFC's `MiFareTag` exposes a related API
 * but the wrapping isn't in react-native-nfc-manager today).
 */
export interface UnlockHuntTagOptions {
  pwd: number[];
  expectedPack?: number[];
  // Tag UID we originally locked this PIN onto, as Android reports it
  // (lowercase hex from `tag.id`). Defends against PIN collisions when
  // the hider has more than one tag — without the UID check, a PIN that
  // happens to match a *different* locked tag's PWD would silently
  // disable that other tag's protection. See Copilot #572 review +
  // the storage contract on `HiddenPiggy.nfcLock.tagUid`.
  expectedUid?: string;
  onTagDetected?: () => void;
}

export async function unlockHuntTag(opts: UnlockHuntTagOptions): Promise<{ tagUid: string }> {
  if (Platform.OS !== 'android') {
    throw new Error('Tag unlock is Android-only for now.');
  }
  try {
    if (!(await ensureNfcStarted())) throw new Error('NFC unavailable on this device');
    await NfcManager.requestTechnology(NfcTech.NfcA, READER_MODE_OPTS);
    const tag = await NfcManager.getTag();
    if (!tag) throw new Error('No tag detected');
    const tagUid = (tag as { id?: string }).id ?? '';
    // UID check runs BEFORE PWD_AUTH so we don't tip off a stranger's
    // tag that we know any PIN at all. Case-insensitive equality — the
    // platform normalises UID hex inconsistently across vendors.
    if (opts.expectedUid && opts.expectedUid.toLowerCase() !== tagUid.toLowerCase()) {
      throw new Error(
        "This isn't the tag we locked. Hold the original Piglet tag against the phone.",
      );
    }
    opts.onTagDetected?.();
    // Family detection so the disable-auth write below targets the
    // right CFG_0 page (215: 0x83, 216: 0xE3). Pre-Copilot-#572-review
    // this was hard-coded to 215's address; on a 216 the write would
    // have hit a user-memory page instead of the config page, leaving
    // the tag still locked (and a stale write in user memory).
    let chip: NtagFamily;
    try {
      const versionBytes = await NfcManager.nfcAHandler.transceive(buildGetVersionFrame());
      const detected = familyFromGetVersion(versionBytes);
      if (!detected) {
        throw new Error("Couldn't identify the chip from its GET_VERSION reply.");
      }
      chip = detected;
    } catch (e) {
      throw new Error(`Tag identification (GET_VERSION) failed: ${(e as Error)?.message ?? e}`);
    }
    const pages = pagesForFamily(chip);
    let pack: number[];
    try {
      pack = await NfcManager.nfcAHandler.transceive(buildPwdAuthFrame(opts.pwd));
    } catch (e) {
      throw new Error(
        `PIN rejected — the tag refused authentication. ${(e as Error)?.message ?? ''}`.trim(),
      );
    }
    if (opts.expectedPack) {
      const match =
        pack.length >= 2 && pack[0] === opts.expectedPack[0] && pack[1] === opts.expectedPack[1];
      if (!match) {
        // Different tag than the one we stored secrets for. Bail out
        // before flipping AUTH0 so we don't accidentally unlock somebody
        // else's tag using a PIN collision.
        throw new Error(
          "PIN matched the chip but this isn't the tag we locked. Try the original tag.",
        );
      }
    }
    await sendTransceive(buildDisableAuthFrame(pages), 'WRITE AUTH0 (unlock)');
    console.log(`[NFC] unlockHuntTag OK — uid=${tagUid} chip=${chip}`);
    return { tagUid };
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

// Coords just read by the foreground reader, keyed to a wall-clock
// timestamp. Used by App.tsx's Linking handler to swallow the
// delayed system NDEF dispatch that fires ~600ms after the foreground
// reader closes when the tag stays near the antenna. Without this the
// finder is yanked from HuntFoundScreen back to HuntPiggyDetail mid-
// claim.
const recentTagReads = new Map<string, number>();
const TAG_DEDUPE_WINDOW_MS = 3_000;

/** Predicate consumed by App.tsx — true if `coord` was just read by
 * our in-app NFC reader and the resulting deep-link dispatch should
 * be ignored to avoid double-handling the same tap. */
export function wasRecentlyRead(coord: string): boolean {
  const at = recentTagReads.get(coord);
  if (at === undefined) return false;
  const stillFresh = Date.now() - at < TAG_DEDUPE_WINDOW_MS;
  if (!stillFresh) recentTagReads.delete(coord);
  return stillFresh;
}

/**
 * Open a foreground NFC reader session and parse the next tag held to
 * the phone as a Hide-a-Piglet payload. Used by the finder claim flow
 * (HuntPiggyDetailScreen → NfcReadSheet) to extract the LNURL bearer
 * token from record 3 of a Piglet tag. The LNURL is never on the public
 * Nostr listing — it ONLY lives on the tag — so a tap is the only way
 * to claim.
 */
export async function readHuntTagPayload(opts: ReadHuntTagOpts = {}): Promise<HuntTagReadResult> {
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
    // Mark this coord as 'recently read' so App.tsx's Linking handler
    // ignores the system NDEF dispatch that fires shortly after our
    // reader closes when the tag is still held near the antenna.
    if (coord) recentTagReads.set(coord, Date.now());
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
