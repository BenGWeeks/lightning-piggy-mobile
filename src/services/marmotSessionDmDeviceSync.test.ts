// An existing 1:1 reaches devices installed AFTER it began (#1559): real MLS
// crypto end to end (WebCrypto removed — Hermes has none). The scheduling and
// selection rules are unit-tested in marmotDmDeviceSync.test.ts.
import type { Filter } from 'nostr-tools';

import { DM_DEVICE_SYNC_COOLDOWN_MS } from './marmotDmDeviceSync';
import { sendMarmotDm } from './marmotSend';
import { NostrConnectError } from './signerErrors';
import { setMarmotSession } from './marmotSession';
import {
  makeInstall,
  makeRelay,
  makeSession,
  makeSigner,
  unwrapWelcomes,
  waitFor,
} from './marmotSessionTestKit';

// Generous in tests: the add must land before the send it precedes.
const OPTS = { dmDeviceSyncWaitMs: 60_000 };

describe('MarmotSession: existing 1:1s add newer devices (no WebCrypto)', () => {
  const realSubtle = globalThis.crypto.subtle;
  const realNow = Date.now;
  let offset = 0;
  /** Jump past the per-chat cooldown (the chat was just checked when created). */
  const later = () => (offset += DM_DEVICE_SYNC_COOLDOWN_MS + 1_000);

  beforeAll(() =>
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true }),
  );
  afterAll(() =>
    Object.defineProperty(globalThis.crypto, 'subtle', { value: realSubtle, configurable: true }),
  );
  beforeEach(() => {
    offset = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
  });
  afterEach(() => {
    setMarmotSession(null);
    jest.restoreAllMocks();
  });

  const slots = (relay: ReturnType<typeof makeRelay>, pubkey: string) =>
    new Set(
      relay.events
        .filter((e) => e.kind === 30443 && e.pubkey === pubkey)
        .map((e) => e.tags.find((t) => t[0] === 'd')?.[1]),
    ).size;

  it("adds the contact's new install before sending, never our own installs", async () => {
    const relay = makeRelay();
    const big = makeSession(relay, undefined, 'nsec', OPTS);
    const littleId = makeSigner();
    const phone = makeInstall(relay, littleId);
    await Promise.all([big.session.start(), phone.session.start()]);
    await waitFor(() => slots(relay, littleId.pubkey) === 1 && slots(relay, big.pubkey) === 1);
    const dm = await big.session.getOrCreateDm(littleId.pubkey);
    const [first] = unwrapWelcomes(relay, littleId);
    expect(await phone.session.acceptWelcome(first)).toMatchObject({ id: dm.id });

    // Later, Little installs a tablet and Big a second phone.
    const tablet = makeInstall(relay, littleId);
    const bigOther = makeInstall(relay, big);
    await Promise.all([tablet.session.start(), bigOther.session.start()]);
    await waitFor(() => slots(relay, littleId.pubkey) === 2 && slots(relay, big.pubkey) === 2);

    later();
    setMarmotSession(big.session);
    const sent = await sendMarmotDm(big.pubkey, littleId.pubkey, { kind: 14, content: 'hi all' });
    expect(sent.success).toBe(true);
    // The peer gets a Welcome; our other install is never invited.
    const toTablet = unwrapWelcomes(relay, littleId).filter((w) => w.id !== first.id);
    const toOwn = unwrapWelcomes(relay, big);
    expect(toTablet).toHaveLength(1);
    expect(toOwn).toHaveLength(0);
    // Same chat, joined from the new installs — the DM is kept, not replaced.
    expect(await tablet.session.acceptWelcome(toTablet[0])).toMatchObject({
      id: dm.id,
      isDm: true,
      memberPubkeys: [big.pubkey],
    });
    expect(big.session.findDm(littleId.pubkey)?.id).toBe(dm.id);
    expect(big.session.listGroups()).toHaveLength(1);
    // The message went out after the add, so the new installs can read it.
    const got = (d: typeof phone, text: string) => d.inbox.some((m) => m.rumor.content === text);
    await waitFor(() => [phone, tablet].every((d) => got(d, 'hi all')));

    // Next check: everyone's already in — nothing is added again.
    later();
    const again = await sendMarmotDm(big.pubkey, littleId.pubkey, { kind: 14, content: 'again' });
    expect(again.success).toBe(true);
    expect(unwrapWelcomes(relay, littleId)).toHaveLength(2);
    expect(unwrapWelcomes(relay, big)).toHaveLength(0);
    await waitFor(() => [phone, tablet].every((d) => got(d, 'again')));
    [phone, tablet, bigOther].forEach((p) => p.session.stop());
  }, 120_000);

  it('a declined remote Welcome suppresses the same package on the real MLS path', async () => {
    const relay = makeRelay();
    const identity = makeSigner();
    const signEvent = jest.fn(async (draft: Parameters<typeof identity.signer.signEvent>[0]) =>
      identity.signer.signEvent(draft),
    );
    const big = makeSession(relay, undefined, 'amber', {
      ...OPTS,
      pubkey: identity.pubkey,
      signerType: 'nip46',
      signer: { ...identity.signer, signEvent },
    });
    const little = makeSession(relay);
    const tablet = makeInstall(relay, little);
    try {
      await Promise.all([big.session.start(), little.session.start()]);
      await waitFor(() => slots(relay, little.pubkey) === 1);
      const dm = await big.session.getOrCreateDm(little.pubkey);
      await little.session.acceptWelcome(unwrapWelcomes(relay, little)[0]);
      await tablet.session.start();
      await waitFor(() => slots(relay, little.pubkey) === 2);
      // Welcome signing fails, but marmot-ts resolves the commit with a delivery failure.
      const beforeDecline = signEvent.mock.calls.length;
      signEvent.mockRejectedValue(new NostrConnectError('permission', 'Signer denied sign_event'));
      later();
      await big.session.syncDmDevices(dm.id, 'send');
      const attempts = signEvent.mock.calls.length;
      expect(attempts).toBeGreaterThan(beforeDecline);
      later();
      await big.session.syncDmDevices(dm.id, 'open');
      await big.session.syncDmDevices(dm.id, 'send');
      expect(signEvent).toHaveBeenCalledTimes(attempts);
    } finally {
      [big, little, tablet].forEach((install) => install.session.stop());
    }
  }, 120_000);

  it('a failed device lookup still sends to the current members', async () => {
    const relay = makeRelay();
    // Installed before the sessions capture `request`.
    const request = relay.network.request;
    let lookupsDown = false;
    relay.network.request = async (relays: string[], filters: Filter | Filter[]) => {
      const list = Array.isArray(filters) ? filters : [filters];
      if (lookupsDown && list.some((f) => f.kinds?.some((k) => k === 30443 || k === 10002))) {
        throw new Error('relay down');
      }
      return request(relays, filters);
    };
    const big = makeSession(relay, undefined, 'nsec', OPTS);
    const little = makeSession(relay);
    await Promise.all([big.session.start(), little.session.start()]);
    await waitFor(() => slots(relay, little.pubkey) === 1);
    const dm = await big.session.getOrCreateDm(little.pubkey);
    expect(await little.session.acceptWelcome(unwrapWelcomes(relay, little)[0])).toMatchObject({
      id: dm.id,
    });

    lookupsDown = true;
    later();
    setMarmotSession(big.session);
    const sent = await sendMarmotDm(big.pubkey, little.pubkey, { kind: 14, content: 'still here' });
    expect(sent.success).toBe(true);
    await waitFor(() => little.inbox.some((m) => m.rumor.content === 'still here'));
    little.session.stop();
  }, 90_000);
});
