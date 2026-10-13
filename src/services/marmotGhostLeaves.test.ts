import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MarmotClient } from '@internet-privacy/marmot-ts';

import { ensureKeyPackageSlot } from './marmotKeyPackageLifecycle';
import { createMemoryMarmotBackend } from './marmotStore';
import { RELAY, makeInstall, makeRelay, makeSession, unwrapWelcomes } from './marmotSessionTestKit';

afterEach(() => jest.restoreAllMocks());

const OWNER = 'aa'.repeat(32);

it('re-sign-in after an account wipe reuses the installation slot', async () => {
  await AsyncStorage.clear();
  const before = createMemoryMarmotBackend();
  const slot = await ensureKeyPackageSlot(before, OWNER);
  await before.clear('meta'); // account sign-out wipes its entire Marmot partition
  const after = createMemoryMarmotBackend();
  expect(await ensureKeyPackageSlot(after, OWNER)).toBe(slot);
  expect(await after.get('meta', 'keyPackageSlot')).toBe(slot);
});

it('two accounts on one installation never share a slot id (relays could link them)', async () => {
  await AsyncStorage.clear();
  const other = 'bb'.repeat(32);
  const slot = await ensureKeyPackageSlot(createMemoryMarmotBackend(), OWNER);
  const otherSlot = await ensureKeyPackageSlot(createMemoryMarmotBackend(), other);
  expect(otherSlot).not.toBe(slot);
  // Each account still finds its own slot again after signing back in.
  expect(await ensureKeyPackageSlot(createMemoryMarmotBackend(), OWNER)).toBe(slot);
  expect(await ensureKeyPackageSlot(createMemoryMarmotBackend(), other)).toBe(otherSlot);
});

it('an existing install adopts the slot its account partition already used', async () => {
  await AsyncStorage.clear();
  const legacy = 'cd'.repeat(32);
  const backend = createMemoryMarmotBackend();
  await backend.set('meta', 'keyPackageSlot', legacy); // pre-upgrade state
  expect(await ensureKeyPackageSlot(backend, OWNER)).toBe(legacy);
  await backend.clear('meta');
  expect(await ensureKeyPackageSlot(createMemoryMarmotBackend(), OWNER)).toBe(legacy);
});

it('four concurrent Welcomes for locally held slots create only one membership', async () => {
  const relay = makeRelay();
  const inviter = makeSession(relay);
  const receiver = makeSession(relay);
  try {
    await Promise.all([inviter.session.start(), receiver.session.start()]);
    await receiver.session.ensureKeyPackage();
    // Legacy state: this ONE install has secrets for four advertised slots.
    const client = (receiver.session as unknown as { client: MarmotClient }).client;
    for (const digit of ['a', 'b', 'c']) {
      await client.keyPackages.create({
        relays: [RELAY],
        identifier: digit.repeat(64),
        client: 'Lightning Piggy',
      });
    }
    // Freeze rotation to isolate Welcome handling from the lifecycle fix.
    jest.spyOn(receiver.session, 'ensureKeyPackage').mockResolvedValue();
    const join = jest.spyOn(client, 'joinGroupFromWelcome');
    const group = await inviter.session.createGroup('Ghost leaves', [receiver.pubkey]);
    const welcomes = unwrapWelcomes(relay, receiver);
    expect(welcomes).toHaveLength(4);
    const results = await Promise.all(welcomes.map((w) => receiver.session.acceptWelcome(w)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(join).toHaveBeenCalledTimes(1);
    expect(receiver.session.listGroups()).toHaveLength(1);
    expect(receiver.session.listGroups()[0].id).toBe(group.id);
    expect(await receiver.backend.keys('pendingWelcomes')).toEqual([]);
    // Re-delivery after the first join must also bypass the library join.
    await Promise.all(welcomes.map((w) => receiver.session.acceptWelcome(w)));
    expect(join).toHaveBeenCalledTimes(1);
  } finally {
    inviter.session.stop();
    receiver.session.stop();
  }
}, 90_000);

it('the same Welcome delivered twice at once joins once and both callers see the group', async () => {
  // Inbox delivery + resume scan (or an approved invitation) overlap on ONE
  // rumor id. The second caller must share the attempt: an immediate null
  // (no outcome marker yet) reads as a transient failure downstream.
  const relay = makeRelay();
  const inviter = makeSession(relay);
  const receiver = makeSession(relay);
  try {
    await Promise.all([inviter.session.start(), receiver.session.start()]);
    await receiver.session.ensureKeyPackage();
    jest.spyOn(receiver.session, 'ensureKeyPackage').mockResolvedValue();
    const client = (receiver.session as unknown as { client: MarmotClient }).client;
    const join = jest.spyOn(client, 'joinGroupFromWelcome');
    const group = await inviter.session.createGroup('Twice', [receiver.pubkey]);
    const [welcome] = unwrapWelcomes(relay, receiver);
    const results = await Promise.all([
      receiver.session.acceptWelcome(welcome),
      receiver.session.acceptWelcome(welcome),
    ]);
    expect(join).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r?.id)).toEqual([group.id, group.id]);
    expect(receiver.session.listGroups()).toHaveLength(1);
  } finally {
    inviter.session.stop();
    receiver.session.stop();
  }
}, 90_000);

it('copies addressed to sibling installs cannot rejoin using our one matching secret', async () => {
  const relay = makeRelay();
  const inviter = makeSession(relay);
  const receiver = makeSession(relay);
  const siblings = [
    makeInstall(relay, receiver),
    makeInstall(relay, receiver),
    makeInstall(relay, receiver),
  ];
  const installs = [inviter, receiver, ...siblings];
  try {
    await Promise.all(installs.map((p) => p.session.start()));
    await Promise.all(installs.map((p) => p.session.ensureKeyPackage()));
    const client = (receiver.session as unknown as { client: MarmotClient }).client;
    expect(await client.keyPackages.list()).toHaveLength(1);
    jest.spyOn(receiver.session, 'ensureKeyPackage').mockResolvedValue();
    const join = jest.spyOn(client, 'joinGroupFromWelcome');
    await inviter.session.createGroup('Shared Welcome', [receiver.pubkey]);
    const welcomes = unwrapWelcomes(relay, receiver);
    expect(welcomes).toHaveLength(4);
    expect(new Set(welcomes.map((w) => w.content)).size).toBe(1);
    const results = await Promise.all(welcomes.map((w) => receiver.session.acceptWelcome(w)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(join).toHaveBeenCalledTimes(1);
  } finally {
    installs.forEach((p) => p.session.stop());
  }
}, 90_000);
