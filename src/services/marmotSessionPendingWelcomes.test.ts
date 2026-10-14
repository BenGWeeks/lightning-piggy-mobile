import type { MarmotClient } from '@internet-privacy/marmot-ts';
import { AppState, type AppStateStatus } from 'react-native';
import { makeRelay, makeSession, unwrapWelcomes } from './marmotSessionTestKit';

// Real Welcome + real MLS join: retries must use the same per-Welcome guard
// as the inbox and must leave a successfully joined Welcome handled durably.
test('resume retries a transient Welcome and does not duplicate an inbox join in flight', async () => {
  const changes: ((state: AppStateStatus) => void)[] = [];
  const stateSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, listener) => {
    changes.push(listener);
    return { remove: jest.fn() };
  });
  const relay = makeRelay();
  const alice = makeSession(relay);
  const bob = makeSession(relay);
  try {
    await alice.session.start();
    await bob.session.start();
    await bob.session.ensureKeyPackage();
    await alice.session.createGroup('retry', [bob.pubkey]);
    const welcome = unwrapWelcomes(relay, bob)[0];
    const client = (bob.session as unknown as { client: MarmotClient }).client;
    const original = client.joinGroupFromWelcome.bind(client);
    const join = jest.spyOn(client, 'joinGroupFromWelcome');
    join.mockRejectedValueOnce(new Error('relay offline'));
    expect(await bob.session.acceptWelcome(welcome)).toBeNull();
    expect(await bob.backend.get('pendingWelcomes', welcome.id)).toBeTruthy();
    jest.useFakeTimers();
    changes.forEach((change) => change('background'));
    changes.forEach((change) => change('active'));
    await jest.advanceTimersByTimeAsync(2_999);
    expect(join).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(join).toHaveBeenCalledTimes(2);
    expect(bob.session.listGroups()).toHaveLength(1);
    expect(await bob.backend.get('pendingWelcomes', welcome.id)).toBeNull();
    jest.useRealTimers();

    // A second Welcome races inbox delivery with the resume scan. Later
    // callers for the SAME rumor share the in-flight join (#1426): they must
    // neither start another MLS join nor get an immediate null, which
    // marmotPendingInvitations would read as a transient failure.
    await alice.session.createGroup('in-flight', [bob.pubkey]);
    const second = unwrapWelcomes(relay, bob).find((w) => w.id !== welcome.id)!;
    let release!: () => void;
    join.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => (release = resolve));
      return original(...args);
    });
    const joining = bob.session.acceptWelcome(second);
    const duplicate = bob.session.acceptWelcome(second);
    // Wait until the join has entered, with its durable pending row written.
    while (!release) await new Promise((resolve) => setTimeout(resolve, 10));
    jest.useFakeTimers();
    changes.forEach((change) => change('background'));
    changes.forEach((change) => change('active'));
    await jest.advanceTimersByTimeAsync(3_000);
    expect(join).toHaveBeenCalledTimes(3);
    release();
    const [joined, shared] = await Promise.all([joining, duplicate]);
    expect(joined?.id).toBeTruthy();
    expect(shared?.id).toBe(joined?.id);
    expect(join).toHaveBeenCalledTimes(3);
    expect(bob.session.listGroups()).toHaveLength(2);
    expect(await bob.backend.get('pendingWelcomes', second.id)).toBeNull();
  } finally {
    alice.session.stop();
    bob.session.stop();
    stateSpy.mockRestore();
    jest.restoreAllMocks();
    jest.useRealTimers();
  }
}, 30_000);
