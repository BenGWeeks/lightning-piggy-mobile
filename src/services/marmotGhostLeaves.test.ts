import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MarmotClient } from '@internet-privacy/marmot-ts';

import { ensureKeyPackageSlot } from './marmotKeyPackageLifecycle';
import { createMemoryMarmotBackend } from './marmotStore';
import { RELAY, makeInstall, makeRelay, makeSession, unwrapWelcomes } from './marmotSessionTestKit';

afterEach(() => jest.restoreAllMocks());

it('re-sign-in after an account wipe reuses the installation slot', async () => {
  await AsyncStorage.clear();
  const before = createMemoryMarmotBackend();
  const slot = await ensureKeyPackageSlot(before);
  await before.clear('meta'); // account sign-out wipes its entire Marmot partition
  const after = createMemoryMarmotBackend();
  expect(await ensureKeyPackageSlot(after)).toBe(slot);
  expect(await after.get('meta', 'keyPackageSlot')).toBe(slot);
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
