import type { AbstractRelay } from 'nostr-tools/abstract-relay';
import { verifyEvent, type Event, type EventTemplate } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import { getCurrentUserPubkey } from './nostrActiveAccount';
import { isTestRelayLockdown, TEST_RELAY_URL } from '../config/testRelayLockdown';

export const RELAY_AUTH_TIMEOUT_MS = 15_000;
export interface RelayAuthAccount {
  pubkey: string;
  signerType: string;
  ownRelays: string[];
  sign: (event: EventTemplate) => Promise<Event | null>;
}
let account: RelayAuthAccount | null = null;
// Session decisions survive list refreshes and account switches, but never persist.
const remoteAttempts = new Map<
  string,
  { relay: AbstractRelay; challenge: string | undefined; result: Promise<void> }
>();
const inFlight = new Map<
  string,
  { relay: AbstractRelay; pubkey: string | null; result: Promise<void> }
>();
const authenticatedAs = new WeakMap<AbstractRelay, string>();
// nostr-tools caches AUTH across accounts on a shared socket. Its runtime fields
// are private in the types; keep this compatibility seam here (SDK 2.23).
function authState(relay: AbstractRelay) {
  return relay as unknown as { challenge?: string; authPromise?: Promise<string> };
}

export function setRelayAuthAccount(next: RelayAuthAccount | null): void {
  account = next;
}

function bounded<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('auth timed out')), RELAY_AUTH_TIMEOUT_MS);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        // Signer errors can contain the request. Never forward them to SDK logging.
        reject(new Error('auth was required but signing or authentication failed'));
      },
    );
  });
}

/** Sign only on CLOSED auth-required, never on unsolicited relay challenges. */
export function authenticateRelay(relay: AbstractRelay): Promise<void> {
  const owner = account;
  const url = normalizeURL(relay.url);
  const pk = getCurrentUserPubkey();
  if (isTestRelayLockdown(pk) && url !== normalizeURL(TEST_RELAY_URL))
    return Promise.reject(new Error('auth-required: relay outside test lockdown'));
  if (!owner || owner.pubkey !== pk)
    return Promise.reject(new Error('auth-required: no active signer'));
  const key = `${pk}:${url}`;
  const pending = inFlight.get(url);
  if (pending)
    return pending.relay === relay && pending.pubkey === pk
      ? pending.result
      : Promise.reject(new Error('auth-required: another authentication is in flight'));
  const remote = owner.signerType !== 'nsec';
  if (remote && !owner.ownRelays.some((own) => normalizeURL(own) === url))
    return Promise.reject(new Error('auth-required: relay outside own inbox/read lists'));
  const previous = remoteAttempts.get(key);
  if (remote && previous) {
    // A new socket/challenge needs a new signature; never reuse an old AUTH event
    // or open the remote signer a second time this session.
    return previous.relay === relay && previous.challenge === authState(relay).challenge
      ? previous.result.then(() => {
          if (authenticatedAs.get(relay) !== pk)
            throw new Error('auth-required: socket authenticated as another account');
        })
      : Promise.reject(new Error('auth-required: remote signer already asked this session'));
  }
  const current = () => getCurrentUserPubkey() === pk && account?.pubkey === pk;
  const result = (async () => {
    const challenge = authState(relay).challenge;
    if (!challenge) throw new Error('auth-required: no challenge');
    const template: EventTemplate = {
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['relay', relay.url],
        ['challenge', challenge],
      ],
      content: '',
    };
    const expectedTags = JSON.stringify(template.tags);
    const expectedTime = template.created_at;
    // Sign before SDK auth(): its async executor swallows signer rejection.
    const signed = await bounded(owner.sign(template));
    if (!signed || !current() || authState(relay).challenge !== challenge || signed.pubkey !== pk)
      throw new Error('auth-required: signing declined or account/challenge changed');
    if (
      signed.kind !== template.kind ||
      signed.content !== '' ||
      JSON.stringify(signed.tags) !== expectedTags ||
      signed.created_at !== expectedTime ||
      !verifyEvent(signed)
    )
      throw new Error('auth-required: invalid signed event');
    authState(relay).authPromise = undefined;
    await bounded(
      relay.auth(async () => {
        if (!current()) throw new Error('auth-required: account changed');
        return signed;
      }),
    );
    if (!current()) throw new Error('auth-required: account changed');
    authenticatedAs.set(relay, pk!);
  })();
  inFlight.set(url, { relay, pubkey: pk, result });
  if (remote) remoteAttempts.set(key, { relay, challenge: authState(relay).challenge, result });
  void result.then(
    () => inFlight.delete(url),
    () => inFlight.delete(url),
  );
  return result;
}
