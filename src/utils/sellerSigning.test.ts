import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { assertSigningKey, signSellerMutation } from './sellerSigning';
const key = new Uint8Array(32).fill(7);
const pubkey = getPublicKey(key);
const template = { kind: 30405, created_at: 100, tags: [['d', 'shop']], content: 'A shop' };

it('rejects another account’s local key before signing', () => {
  expect(() => assertSigningKey(new Uint8Array(32).fill(8), pubkey)).toThrow();
  expect(() => assertSigningKey(key, pubkey)).not.toThrow();
});
it.each(['pubkey', 'kind', 'created_at', 'content', 'tags', 'sig'])(
  'rejects changed signed %s',
  async (field) => {
    const signed = finalizeEvent(template, key);
    const changes = {
      pubkey: 'f'.repeat(64),
      kind: 1,
      created_at: 101,
      content: 'B shop',
      tags: [],
      sig: '0'.repeat(128),
    };
    await expect(
      signSellerMutation({
        pubkey,
        template,
        isCurrent: () => true,
        sign: async () => ({ ...signed, [field]: changes[field as keyof typeof changes] }),
      }),
    ).rejects.toThrow();
  },
);
it('cancels a pending signature when the account changes', async () => {
  let current = true;
  await expect(
    signSellerMutation({
      pubkey,
      template,
      isCurrent: () => current,
      sign: async () => {
        current = false;
        return finalizeEvent(template, key);
      },
    }),
  ).rejects.toThrow('account changed');
});
it('accepts only the initiating account’s exact template', async () => {
  const signed = finalizeEvent(template, key);
  await expect(
    signSellerMutation({ pubkey, template, isCurrent: () => true, sign: async () => signed }),
  ).resolves.toBe(signed);
});
