import { npubEncode } from 'nostr-tools/nip19';
import type { NostrContact } from '../types/nostr';

/** Invoice metadata is untrusted display copy, never an identity. */
export function sanitizeInvoiceMemo(value: string | null | undefined): string {
  const clean = (value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').normalize('NFC');
  const chars = Array.from(clean);
  return chars.length > 140 ? chars.slice(0, 139).join('') + '…' : clean;
}

export function paymentRecipientLabel(opts: {
  address?: string | null;
  pubkey?: string;
  contacts: readonly NostrContact[];
  nodePubkey?: string | null;
  unknownLabel: string;
}): string {
  if (opts.address) return opts.address;
  const contact = opts.contacts.find((c) => c.pubkey === opts.pubkey);
  if (contact) {
    return (
      sanitizeInvoiceMemo(
        contact.petname || contact.profile?.displayName || contact.profile?.name,
      ) || npubEncode(contact.pubkey)
    );
  }
  if (opts.nodePubkey && /^(02|03)[0-9a-f]{64}$/i.test(opts.nodePubkey)) {
    return opts.nodePubkey.slice(0, 12) + '…' + opts.nodePubkey.slice(-8);
  }
  return opts.unknownLabel;
}
