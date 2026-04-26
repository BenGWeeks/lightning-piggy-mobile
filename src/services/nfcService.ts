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

/**
 * Initialize the NFC manager. Call once at app startup.
 */
export async function initNfc(): Promise<boolean> {
  try {
    await NfcManager.start();
    return true;
  } catch {
    return false;
  }
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
