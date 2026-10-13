import { AppState, type AppStateStatus } from 'react-native';
import type { MarmotClient } from '@internet-privacy/marmot-ts';

import { installMarmotCryptoProvider } from './marmotCryptoProvider';
import { KEY_PACKAGE_REPLENISH_MS } from './marmotKeyPackageReplenisher';
import { makeRelay, makeSession, unwrapWelcomes } from './marmotSessionTestKit';

it.each([false, true])(
  'a Welcome replenishes the same slot within 30s, retries rejection=%s, and creates no duplicate slots',
  async (failFirst) => {
    installMarmotCryptoProvider();
    const relay = makeRelay();
    let change!: (state: AppStateStatus) => void;
    const listen = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        change = listener;
        return { remove: jest.fn() };
      });
    const alice = makeSession(relay);
    let inviteePubkey = '';
    const publish = relay.network.publish;
    let reject = false;
    relay.network.publish = async (relays, event) => {
      if (reject && event.kind === 30443 && event.pubkey === inviteePubkey) {
        return Object.fromEntries(relays.map((r) => [r, { from: r, ok: false }]));
      }
      return publish(relays, event);
    };
    const invitee = makeSession(relay);
    inviteePubkey = invitee.pubkey;
    change('active');
    const client = (invitee.session as unknown as { client: MarmotClient }).client;
    try {
      await Promise.all([alice.session.start(), invitee.session.start()]);
      await Promise.all([alice.session.ensureKeyPackage(), invitee.session.ensureKeyPackage()]);
      const keys = () =>
        relay.events.filter((e) => e.kind === 30443 && e.pubkey === invitee.pubkey);
      const original = keys()[0];
      const slot = original.tags.find((t) => t[0] === 'd')![1];
      const old = (await client.keyPackages.list())[0];
      await alice.session.createGroup('replenish', [invitee.pubkey]);
      const welcome = unwrapWelcomes(relay, invitee)[0];
      jest.useFakeTimers();
      expect(await invitee.session.acceptWelcome(welcome)).not.toBeNull();
      expect(await invitee.session.acceptWelcome(welcome)).toBeNull();
      reject = failFirst;
      await jest.advanceTimersByTimeAsync(KEY_PACKAGE_REPLENISH_MS - 1);
      expect(keys()).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1);
      if (failFirst) {
        expect(keys()).toHaveLength(1); // rejected replacement isn't on the relay
        expect(await client.keyPackages.getPrivateKey(old.keyPackageRef)).not.toBeNull();
        reject = false;
        await jest.advanceTimersByTimeAsync(KEY_PACKAGE_REPLENISH_MS);
      }
      expect(keys()).toHaveLength(2);
      expect(new Set(keys().map((e) => e.tags.find((t) => t[0] === 'd')![1]))).toEqual(
        new Set([slot]),
      );
      expect(keys()[1].created_at).toBeGreaterThan(original.created_at);
      expect(await client.keyPackages.list()).toHaveLength(1);
      expect(await client.keyPackages.getPrivateKey(old.keyPackageRef)).toBeNull();
      await jest.advanceTimersByTimeAsync(5 * 60_000);
      expect(keys()).toHaveLength(2);
    } finally {
      alice.session.stop();
      invitee.session.stop();
      jest.useRealTimers();
      listen.mockRestore();
    }
  },
  60_000,
);

it('a remote signer is asked once per trigger: a rejected republish is not retried on a loop', async () => {
  installMarmotCryptoProvider();
  const relay = makeRelay();
  let change!: (state: AppStateStatus) => void;
  const listen = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    change = listener;
    return { remove: jest.fn() };
  });
  const alice = makeSession(relay);
  let inviteePubkey = '';
  let reject = false;
  let attempts = 0; // every signature a remote signer would have to approve
  const publish = relay.network.publish;
  relay.network.publish = async (relays, event) => {
    if (event.kind === 30443 && event.pubkey === inviteePubkey) {
      attempts++;
      if (reject) return Object.fromEntries(relays.map((r) => [r, { from: r, ok: false }]));
    }
    return publish(relays, event);
  };
  const invitee = makeSession(relay, undefined, 'amber');
  inviteePubkey = invitee.pubkey;
  change('active');
  try {
    await Promise.all([alice.session.start(), invitee.session.start()]);
    await Promise.all([alice.session.ensureKeyPackage(), invitee.session.ensureKeyPackage()]);
    expect(attempts).toBe(1);
    await alice.session.createGroup('replenish', [invitee.pubkey]);
    const welcome = unwrapWelcomes(relay, invitee)[0];
    jest.useFakeTimers();
    expect(await invitee.session.acceptWelcome(welcome)).not.toBeNull();
    reject = true;
    await jest.advanceTimersByTimeAsync(KEY_PACKAGE_REPLENISH_MS);
    expect(attempts).toBe(2); // the one debounced republish the join asked for
    await jest.advanceTimersByTimeAsync(15 * 60_000);
    expect(attempts).toBe(2); // no backoff loop: each retry would be another Amber prompt
    // The next ordinary trigger (resume / start / join) still tries again.
    reject = false;
    await invitee.session.ensureKeyPackage();
    expect(attempts).toBe(3);
  } finally {
    alice.session.stop();
    invitee.session.stop();
    jest.useRealTimers();
    listen.mockRestore();
  }
}, 60_000);
