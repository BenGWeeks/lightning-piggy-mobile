import { getPublicKey, verifyEvent, type Event, type EventTemplate } from 'nostr-tools';

export class SellerSigningError extends Error {}

/** Never use a replacement account's local key for an in-flight request. */
export function assertSigningKey(secretKey: Uint8Array, pubkey: string): void {
  if (getPublicKey(secretKey) !== pubkey) throw new SellerSigningError('Signing account changed');
}

/** External signers must return precisely the requested account and payload. */
export async function signSellerMutation(input: {
  pubkey: string;
  template: EventTemplate;
  isCurrent: () => boolean;
  sign: (template: EventTemplate) => Promise<Event | null>;
}): Promise<Event> {
  if (!input.isCurrent()) throw new SellerSigningError('Signing account changed');
  const expected = JSON.parse(JSON.stringify(input.template)) as EventTemplate;
  const signed = await input.sign(input.template);
  if (!input.isCurrent()) throw new SellerSigningError('Signing account changed');
  if (
    !signed ||
    signed.pubkey !== input.pubkey ||
    signed.kind !== expected.kind ||
    signed.created_at !== expected.created_at ||
    signed.content !== expected.content ||
    JSON.stringify(signed.tags) !== JSON.stringify(expected.tags) ||
    !verifyEvent({
      id: signed.id,
      pubkey: signed.pubkey,
      kind: signed.kind,
      created_at: signed.created_at,
      content: signed.content,
      tags: signed.tags,
      sig: signed.sig,
    })
  )
    throw new SellerSigningError('Signer returned an unexpected event');
  return signed;
}
