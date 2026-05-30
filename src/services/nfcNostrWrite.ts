// Single-record `nostr:` profile writers for NFC tags. Extracted from
// nfcService (#754/#755) so that over-cap service shrinks: the Hunt /
// LNURL multi-record + lock path stays in nfcService, while the simple
// "write one nostr: URI record" helpers live here. Both share
// nfcService's reader-mode flags + lazy session-start so there's one
// source of truth for NFC bootstrap.
import NfcManager, { NfcTech, Ndef } from 'react-native-nfc-manager';
import { READER_MODE_OPTS, ensureNfcStarted } from './nfcService';

// Write a single NDEF URI record holding a `nostr:` URI. "nostr:" isn't in
// the standard NFC URI prefix table, so `Ndef.uriRecord` emits prefix code
// 0x00 (no prefix) with the full URI inline.
async function writeNostrUriRecord(uri: string, onTagDetected?: () => void): Promise<void> {
  try {
    if (!(await ensureNfcStarted())) {
      throw new Error('NFC unavailable on this device');
    }
    await NfcManager.requestTechnology(NfcTech.Ndef, READER_MODE_OPTS);

    const tag = await NfcManager.getTag();
    if (!tag) {
      throw new Error('No tag detected');
    }

    // Tag detected — caller flips its UI to the "writing" state.
    onTagDetected?.();

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
 * Write a `nostr:` profile reference to an NFC tag as an NDEF URI record.
 *
 * Accepts a bare `npub1…` / `nprofile1…` bech32 OR an already-prefixed
 * `nostr:…` URI. `nprofile` is preferred for contact badges — it carries
 * the owner's outbox relay hints so a cold first-contact scanner resolves
 * the profile even on niche relays (#755). `npub` stays valid for callers
 * that only have an identity with no relay context.
 *
 * @param ref - `npub1…`, `nprofile1…`, or a `nostr:`-prefixed form thereof
 * @param onTagDetected - Optional callback fired when a tag is detected (before write)
 */
export async function writeNostrProfileToTag(
  ref: string,
  onTagDetected?: () => void,
): Promise<void> {
  const body = ref.replace(/^nostr:/i, '');
  if (!body.startsWith('npub1') && !body.startsWith('nprofile1')) {
    throw new Error('Invalid Nostr profile reference (expected npub or nprofile)');
  }
  await writeNostrUriRecord(`nostr:${body}`, onTagDetected);
}

/**
 * @deprecated Prefer {@link writeNostrProfileToTag}, which also accepts an
 * `nprofile` (npub + relay hints) for cold-contact resolution (#755).
 * Retained as a thin wrapper for any caller that only has a bare npub.
 *
 * Write an npub to an NFC tag as an NDEF URI record (`nostr:npub1…`).
 */
export async function writeNpubToTag(npub: string, onTagDetected?: () => void): Promise<void> {
  if (!npub.startsWith('npub1')) {
    throw new Error('Invalid npub format');
  }
  await writeNostrUriRecord(`nostr:${npub}`, onTagDetected);
}
