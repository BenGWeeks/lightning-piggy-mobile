// Adapts the app's three signer backends (nsec / Amber / NIP-46) to the
// applesauce `EventSigner` shape marmot-ts expects.
//
// marmot-ts only needs the user's Nostr key for a handful of operations —
// signing key packages (kind 30443) + their account-identity proof, and
// sealing gift-wrapped Welcomes (NIP-44 encrypt + sign kind 13). MLS group
// traffic (kind 445) is signed with per-message ephemeral keys inside the
// library, so remote signers are NOT prompted per chat message.
//
// Calls are serialised through one queue: Amber's native module rejects
// concurrent Intents with `BUSY`, and marmot-ts can fan out (e.g. inviting
// several members seals several Welcomes).

import * as SecureStore from 'expo-secure-store';
import type { EventSigner } from 'applesauce-core';

import { NSEC_KEY } from '../contexts/nostrAuthKeys';
import type { SignerType } from '../types/nostr';
import * as amberService from './amberService';
import { nip44DecryptFrom, nip44EncryptForRecipient } from './nostrCrypto';
import * as nostrConnectService from './nostrConnectService';
import * as nostrService from './nostrService';

type Draft = Parameters<EventSigner['signEvent']>[0];
type Signed = Awaited<ReturnType<EventSigner['signEvent']>>;

/** Runs async tasks strictly one at a time, in submission order. */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

async function loadSecretKey(): Promise<Uint8Array> {
  const nsec = await SecureStore.getItemAsync(NSEC_KEY);
  if (!nsec) throw new Error('marmot signer: no nsec stored');
  return nostrService.decodeNsec(nsec).secretKey;
}

/** The unsigned template a remote signer should sign (no id/sig). */
const toTemplate = (draft: Draft, pubkey: string) => ({
  kind: draft.kind,
  created_at: draft.created_at,
  tags: draft.tags,
  content: draft.content,
  pubkey,
});

export function createMarmotSigner(pubkey: string, signerType: SignerType): EventSigner {
  const enqueue = createSerialQueue();

  const parseSigned = (json: string | null | undefined, who: string): Signed => {
    if (!json) throw new Error(`marmot signer: ${who} returned no signed event`);
    return JSON.parse(json) as Signed;
  };

  const signEvent = (draft: Draft): Promise<Signed> =>
    enqueue(async () => {
      const template = toTemplate(draft, pubkey);
      switch (signerType) {
        case 'nsec':
          return nostrService.signEvent(template, await loadSecretKey()) as Signed;
        case 'amber': {
          // Keep pubkey on the template — Amber misroutes sign_event Intents
          // without it (#356).
          const { event } = await amberService.requestEventSignature(
            JSON.stringify(template),
            '',
            pubkey,
          );
          return parseSigned(event, 'Amber');
        }
        case 'nip46': {
          const { event } = await nostrConnectService.requestEventSignature(
            JSON.stringify(template),
            '',
            pubkey,
          );
          return parseSigned(event, 'NIP-46 signer');
        }
      }
    });

  const nip44 = {
    encrypt: (peer: string, plaintext: string) =>
      enqueue(async () => {
        switch (signerType) {
          case 'nsec':
            return nip44EncryptForRecipient(plaintext, await loadSecretKey(), peer);
          case 'amber':
            return amberService.requestNip44Encrypt(plaintext, peer, pubkey);
          case 'nip46':
            return nostrConnectService.requestNip44Encrypt(plaintext, peer, pubkey);
        }
      }),
    decrypt: (peer: string, ciphertext: string) =>
      enqueue(async () => {
        switch (signerType) {
          case 'nsec':
            return nip44DecryptFrom(ciphertext, await loadSecretKey(), peer);
          case 'amber':
            return amberService.requestNip44Decrypt(ciphertext, peer, pubkey);
          case 'nip46':
            return nostrConnectService.requestNip44Decrypt(ciphertext, peer, pubkey);
        }
      }),
  };

  return { getPublicKey: () => pubkey, signEvent, nip44 };
}
