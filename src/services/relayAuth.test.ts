import { AbstractRelay } from 'nostr-tools/abstract-relay';
import { finalizeEvent, getPublicKey, type EventTemplate } from 'nostr-tools/pure';
import { authenticateRelay, setRelayAuthAccount, RELAY_AUTH_TIMEOUT_MS } from './relayAuth';
import { setCurrentUserPubkey } from './nostrActiveAccount';
import { TEST_ACCOUNT_PUBKEYS, TEST_RELAY_URL } from '../config/testRelayLockdown';

const secret = new Uint8Array(32).fill(1);
const pubkey = getPublicKey(secret);
let serial = 0;
function setup(signerType = 'nsec', own = true, url = `wss://auth-${serial++}.example/`) {
  const relay = new AbstractRelay(url, { verifyEvent: (() => true) as never });
  Object.assign(relay, { challenge: 'challenge-value' });
  const sign = jest.fn(async (event: EventTemplate) => finalizeEvent(event, secret));
  const auth = jest.spyOn(relay, 'auth').mockImplementation(async (signer) => {
    await signer({ kind: 22242, tags: [], content: '', created_at: 0 });
    return 'authenticated';
  });
  setCurrentUserPubkey(pubkey);
  setRelayAuthAccount({ pubkey, signerType, ownRelays: own ? [url] : [], sign });
  return { relay, sign, auth };
}

afterEach(() => {
  setRelayAuthAccount(null);
  setCurrentUserPubkey(null);
  jest.useRealTimers();
});

test('local signer silently signs the connected URL and challenge, even outside own lists', async () => {
  const { relay, sign, auth } = setup('nsec', false);
  await authenticateRelay(relay);
  expect(sign).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 22242,
      created_at: expect.any(Number),
      content: '',
      tags: [
        ['relay', relay.url],
        ['challenge', 'challenge-value'],
      ],
    }),
  );
  expect(auth).toHaveBeenCalledTimes(1);
});

test.each(['amber', 'nip46'])(
  '%s is asked once per relay per session, across concurrent reads and reconnects',
  async (type) => {
    const { relay, sign } = setup(type);
    await Promise.all([authenticateRelay(relay), authenticateRelay(relay)]);
    await authenticateRelay(relay);
    const reconnected = new AbstractRelay(relay.url, { verifyEvent: (() => true) as never });
    Object.assign(reconnected, { challenge: 'new-challenge' });
    await expect(authenticateRelay(reconnected)).rejects.toThrow('already asked');
    expect(sign).toHaveBeenCalledTimes(1);
  },
);

test.each(['amber', 'nip46'])('%s never prompts outside own inbox/read lists', async (type) => {
  const { relay, sign, auth } = setup(type, false);
  await expect(authenticateRelay(relay)).rejects.toThrow('outside own');
  expect(sign).not.toHaveBeenCalled();
  expect(auth).not.toHaveBeenCalled();
});

test('decline remains cached when account configuration is refreshed', async () => {
  const { relay, sign, auth } = setup('amber');
  sign.mockRejectedValueOnce(new Error('declined'));
  await expect(authenticateRelay(relay)).rejects.toThrow('signing or authentication failed');
  setRelayAuthAccount({ pubkey, signerType: 'amber', ownRelays: [relay.url], sign });
  await expect(authenticateRelay(relay)).rejects.toThrow('signing or authentication failed');
  expect(sign).toHaveBeenCalledTimes(1);
  expect(auth).not.toHaveBeenCalled();
});

test('signer timeout is cached and late signing cannot send AUTH', async () => {
  jest.useFakeTimers();
  const { relay, sign, auth } = setup('nip46');
  let resolve!: (value: ReturnType<typeof finalizeEvent>) => void;
  sign.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const attempt = authenticateRelay(relay);
  const assertion = expect(attempt).rejects.toThrow('auth timed out');
  await jest.advanceTimersByTimeAsync(RELAY_AUTH_TIMEOUT_MS);
  await assertion;
  resolve(finalizeEvent(sign.mock.calls[0][0], secret));
  await expect(authenticateRelay(relay)).rejects.toThrow('auth timed out');
  expect(auth).not.toHaveBeenCalled();
  expect(sign).toHaveBeenCalledTimes(1);
});

test('relay acknowledgement is bounded too', async () => {
  jest.useFakeTimers();
  const { relay, auth } = setup();
  auth.mockImplementationOnce(() => new Promise(() => {}));
  const assertion = expect(authenticateRelay(relay)).rejects.toThrow('auth timed out');
  await jest.advanceTimersByTimeAsync(RELAY_AUTH_TIMEOUT_MS);
  await assertion;
});

test('account switch while signing prevents AUTH', async () => {
  const { relay, sign, auth } = setup();
  sign.mockImplementationOnce(async (event) => {
    setCurrentUserPubkey('other-account');
    return finalizeEvent(event, secret);
  });
  await expect(authenticateRelay(relay)).rejects.toThrow('account/challenge changed');
  expect(auth).not.toHaveBeenCalled();
});

test('locked test account authenticates only to LAN', async () => {
  const lockedPubkey = [...TEST_ACCOUNT_PUBKEYS][0];
  const { relay, sign, auth } = setup();
  setCurrentUserPubkey(lockedPubkey);
  setRelayAuthAccount({ pubkey: lockedPubkey, signerType: 'nsec', ownRelays: [], sign });
  await expect(authenticateRelay(relay)).rejects.toThrow('outside test lockdown');
  expect(sign).not.toHaveBeenCalled();
  expect(auth).not.toHaveBeenCalled();
  // Add this suite's disposable signer to the real lockdown set, without
  // loading any project identity's private keys.
  (TEST_ACCOUNT_PUBKEYS as Set<string>).add(pubkey);
  try {
    const lan = setup('nsec', false, TEST_RELAY_URL);
    await authenticateRelay(lan.relay);
    expect(lan.sign).toHaveBeenCalledTimes(1);
    expect(lan.auth).toHaveBeenCalledTimes(1);
    expect(lan.sign.mock.calls[0][0].tags[0]).toEqual(['relay', lan.relay.url]);
  } finally {
    (TEST_ACCOUNT_PUBKEYS as Set<string>).delete(pubkey);
  }
});
