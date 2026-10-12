// A person's devices in a Marmot chat (#1267), end to end over real MLS:
// Big invites both of Little's installs into a 1:1, and every client can say
// who is on how many devices, which app each one is, and draws the alpha
// "joined on N devices" notice locally from the commit. WebCrypto removed
// (Hermes has none), like the other session tests.
import { MARMOT_GROUP_ID_PREFIX } from './marmotSession';
import {
  makeInstall,
  makeRelay,
  makeSession,
  makeSigner,
  unwrapWelcomes,
  waitFor,
} from './marmotSessionTestKit';

const mlsId = (appGroupId: string) => appGroupId.slice(MARMOT_GROUP_ID_PREFIX.length);

describe('MarmotSession devices per person (no WebCrypto)', () => {
  const realSubtle = globalThis.crypto.subtle;
  beforeAll(() =>
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true }),
  );
  afterAll(() =>
    Object.defineProperty(globalThis.crypto, 'subtle', { value: realSubtle, configurable: true }),
  );

  it('lists each person’s devices, names the apps it can, and notes who joined on how many', async () => {
    const relay = makeRelay();
    const big = makeSession(relay);
    const littleId = makeSigner();
    const [phone, tablet] = [makeInstall(relay, littleId), makeInstall(relay, littleId)];
    await Promise.all([big, phone, tablet].map((p) => p.session.start()));
    await waitFor(
      () =>
        relay.events.filter((e) => e.kind === 30443 && e.pubkey === littleId.pubkey).length === 2,
    );

    const changed: string[] = [];
    big.session.devices.subscribe((id) => changed.push(id));
    const dm = await big.session.getOrCreateDm(littleId.pubkey);
    const id = mlsId(dm.id);

    // Big's view: one leaf of his own, two of Little's.
    expect(big.session.devices.counts(id)).toEqual(
      new Map([
        [big.pubkey, 1],
        [littleId.pubkey, 2],
      ]),
    );
    // The invite commit is compared against the baseline taken at creation.
    await waitFor(() => changed.includes(id));
    const notices = await big.session.devices.notices(id);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ pubkey: littleId.pubkey, joined: true, epoch: 1 });
    expect(notices[0].keys).toHaveLength(2);
    expect(notices[0].clients).toEqual(['Lightning Piggy', 'Lightning Piggy']);

    const bigView = await big.session.devices.devices(id);
    const mine = bigView?.people.get(big.pubkey) ?? [];
    expect(mine).toEqual([
      expect.objectContaining({
        isOwn: true,
        client: 'Lightning Piggy',
        baseline: true,
        firstEpoch: 0,
      }),
    ]);
    // We invited them, so we hold the invitation keys: app and time are known.
    const littles = bigView?.people.get(littleId.pubkey) ?? [];
    expect(littles).toHaveLength(2);
    for (const d of littles) {
      expect(d).toMatchObject({
        isOwn: false,
        client: 'Lightning Piggy',
        baseline: false,
        firstEpoch: 1,
      });
      expect(d.keyCreatedAt).toEqual(expect.any(Number));
    }
    expect(new Set(littles.map((d) => d.key)).size).toBe(2);

    // Little's phone joins: a baseline, so no notices on its side.
    const [welcome] = unwrapWelcomes(relay, littleId);
    await phone.session.acceptWelcome(welcome);
    const phoneId = id;
    await waitFor(() => phone.session.devices.counts(phoneId) !== null);
    const before = await phone.session.devices.devices(phoneId);
    expect(await phone.session.devices.notices(phoneId)).toEqual([]);
    const ownDevices = before?.people.get(littleId.pubkey) ?? [];
    expect(ownDevices.map((d) => d.isOwn).sort()).toEqual([false, true]);
    expect(ownDevices.find((d) => !d.isOwn)?.client).toBeNull();
    expect(ownDevices.every((d) => d.baseline)).toBe(true);

    // The sheet's relay lookup names the tablet (its invitation key is still
    // published); Big's creator leaf never came from a published key: unknown.
    expect(await phone.session.devices.resolveClients(phoneId)).toBe(true);
    const after = await phone.session.devices.devices(phoneId);
    expect(after?.people.get(littleId.pubkey)?.find((d) => !d.isOwn)?.client).toBe(
      'Lightning Piggy',
    );
    expect(after?.people.get(big.pubkey)?.[0].client).toBeNull();
    // Looked up once per cooldown: a second open doesn't query again.
    const requests = relay.requests.length;
    expect(await phone.session.devices.resolveClients(phoneId)).toBe(false);
    expect(relay.requests.length).toBe(requests);

    [big, phone, tablet].forEach((p) => p.session.stop());
  }, 90_000);
});
