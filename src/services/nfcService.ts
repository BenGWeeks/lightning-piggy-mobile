/**
 * NFC service for reading and writing NDEF tags.
 *
 * Supports scanning tags containing LNURL-pay/withdraw, lightning invoices,
 * lightning addresses, and Nostr npub identities. Also supports writing
 * npub identities to NFC tags.
 */
import NfcManager, { NfcTech, NfcEvents, Ndef, TagEvent } from 'react-native-nfc-manager';
import { Platform, Linking } from 'react-native';

export type NfcTagContent =
  // bech32-encoded LNURL string (lnurl1…). Type unknown until resolved
  // (could be a payRequest or withdrawRequest); the caller fetches and
  // branches on the server's `tag` field.
  | { type: 'lnurl'; data: string }
  // Plain HTTPS LNURL-withdraw endpoint (per LUD-17 the canonical wire
  // form is `lnurlw://…`; this is the same URL with the scheme rewritten
  // to https so it can be GET'd directly). Issue #103.
  | { type: 'lnurl-withdraw'; data: string }
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
 * Rewrite an `lnurlw://`, `lnurlp://` or `keyauth://` scheme to its
 * resolvable transport form. Per LUD-17 the wallet should swap to
 * `https://`, except for `.onion` hosts which should use `http://`.
 * Returns null if the scheme isn't one we recognise.
 */
function lud17ToHttp(input: string): string | null {
  const lower = input.toLowerCase();
  let scheme: string | null = null;
  if (lower.startsWith('lnurlw://')) scheme = 'lnurlw://';
  else if (lower.startsWith('lnurlp://')) scheme = 'lnurlp://';
  else if (lower.startsWith('keyauth://')) scheme = 'keyauth://';
  if (!scheme) return null;

  const rest = input.substring(scheme.length);
  // Determine host (everything up to the first "/", "?" or "#") to
  // decide between https vs http-on-onion. Don't lowercase the rest —
  // the path can be case-sensitive on the server (LNbits k1 tokens are).
  const hostEnd = rest.search(/[/?#]/);
  const host = (hostEnd === -1 ? rest : rest.substring(0, hostEnd)).toLowerCase();
  const transport = host.endsWith('.onion') ? 'http://' : 'https://';
  return transport + rest;
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

  // LUD-17 LNURL-withdraw scheme (`lnurlw://host/...`). Convert to its
  // https (or http-on-onion) transport form so the caller can GET it
  // directly without re-parsing the scheme.
  const lower = input.toLowerCase();
  if (lower.startsWith('lnurlw://')) {
    const url = lud17ToHttp(input);
    if (url) return { type: 'lnurl-withdraw', data: url };
  }

  // LNURL (bech32-encoded, starts with lnurl1) — could be pay or
  // withdraw, the server's response disambiguates.
  if (lower.startsWith('lnurl1')) {
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
  if (lower.startsWith('nostr:npub1')) {
    return { type: 'npub', data: input.substring(6) };
  }
  if (lower.startsWith('npub1')) {
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
 * Cancel any ongoing NFC operation.
 */
export function cancelNfcOperation(): void {
  NfcManager.cancelTechnologyRequest().catch(() => {});
  NfcManager.unregisterTagEvent().catch(() => {});
}

/**
 * Register a passive foreground tag-discovery listener (issue #103).
 *
 * Unlike `scanNfcTag()` which holds an interactive `requestTechnology`
 * session, this uses Android foreground dispatch / iOS reader-session-
 * less polling to surface NDEF tag taps while the app is in the active
 * state. Suitable for "tap a gift-card tag and it just claims" UX.
 *
 * IMPORTANT: keep the listener bound to AppState `active` only —
 * leaving the radio polling in the background drains battery hard. The
 * caller is responsible for unregistering on background; see
 * `NfcWithdrawListener` for the canonical wiring.
 *
 * @param onTag - invoked with parsed tag content for every discovered
 *   tag while the listener is registered. Errors thrown from the
 *   callback are swallowed so a single bad tap can't kill the listener.
 * @returns an unregister function that tears down both the event
 *   listener and the underlying tag-event registration.
 */
export async function registerForegroundTagListener(
  onTag: (content: NfcTagContent) => void,
): Promise<() => void> {
  if (!(await ensureNfcStarted())) {
    // No NFC hardware / driver — return a no-op cleanup so the caller's
    // `useEffect` cleanup path still works without a null check.
    return () => {};
  }

  const handler = (tag: TagEvent) => {
    try {
      const text = extractNdefText(tag);
      if (!text) return;
      const parsed = parseNfcContent(text);
      onTag(parsed);
    } catch {
      // Swallow per-tap errors — logging here would spam in production
      // for any malformed tag the user happens to brush past.
    }
  };

  NfcManager.setEventListener(NfcEvents.DiscoverTag, handler);
  try {
    await NfcManager.registerTagEvent();
  } catch {
    // registerTagEvent rejects on iOS without a Core NFC entitlement,
    // and on Android if NFC was disabled between `isEnabled()` and now.
    // Detach the listener we just attached so we don't leak it.
    NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
    return () => {};
  }

  return () => {
    NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
    NfcManager.unregisterTagEvent().catch(() => {});
  };
}
