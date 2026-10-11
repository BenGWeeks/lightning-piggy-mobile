import { groupLifecycleStates } from '@internet-privacy/marmot-ts';

import {
  canPublishNow,
  MarmotGroupNotReadyError,
  submitWhenSettled,
  type GroupSendIntent,
} from './marmotSendGate';

const intent = { kind: 'selfUpdate' } as GroupSendIntent;

/** A group whose status/lifecycle the test controls; records when it was submitted to. */
function fakeGroup(status = 'Settled', lifecycle: string = groupLifecycleStates.stable) {
  const group = {
    convergenceStatus: status,
    lifecycle,
    submittedWhile: [] as string[],
    submitIntent: jest.fn(async () => {
      group.submittedWhile.push(`${group.convergenceStatus}/${group.lifecycle}`);
      return [];
    }),
  };
  return group;
}
type Fake = ReturnType<typeof fakeGroup>;
type GateGroup = Parameters<typeof submitWhenSettled>[0];
const asGroup = (g: Fake) => g as unknown as GateGroup;
const submit = (g: Fake, opts?: Parameters<typeof submitWhenSettled>[2]) =>
  submitWhenSettled(asGroup(g), intent, opts);

describe('submitWhenSettled — never hand marmot-ts a send it would queue (#1280)', () => {
  it('submits straight away when the group can publish now', async () => {
    const g = fakeGroup();
    await submit(g);
    expect(g.submitIntent).toHaveBeenCalledWith(intent);
  });

  it('waits out a settle window, then submits while settled', async () => {
    const g = fakeGroup('Syncing');
    setTimeout(() => (g.convergenceStatus = 'Settled'), 250);
    await submit(g, { timeoutMs: 5_000 });
    expect(g.submittedWhile).toEqual([`Settled/${groupLifecycleStates.stable}`]);
  });

  it('also waits while our own commit is publishing (lifecycle not stable)', async () => {
    const g = fakeGroup('Settled', groupLifecycleStates.pendingPublish);
    setTimeout(() => (g.lifecycle = groupLifecycleStates.stable), 150);
    await submit(g, { timeoutMs: 5_000 });
    expect(g.submittedWhile).toEqual([`Settled/${groupLifecycleStates.stable}`]);
  });

  it('fails with MarmotGroupNotReadyError (nothing submitted) when the group never settles', async () => {
    const g = fakeGroup('Resolving');
    await expect(submit(g, { timeoutMs: 300 })).rejects.toBeInstanceOf(MarmotGroupNotReadyError);
    expect(g.submitIntent).not.toHaveBeenCalled();
  });

  it('stops waiting as soon as the session stops', async () => {
    const g = fakeGroup('Syncing');
    let stopped = false;
    setTimeout(() => (stopped = true), 150);
    await expect(submit(g, { timeoutMs: 10_000, cancelled: () => stopped })).rejects.toThrow(
      'marmot: session stopped',
    );
    expect(g.submitIntent).not.toHaveBeenCalled();
  });

  it('canPublishNow mirrors marmot-ts: Settled and Stable only', () => {
    expect(canPublishNow(asGroup(fakeGroup()))).toBe(true);
    expect(canPublishNow(asGroup(fakeGroup('Syncing')))).toBe(false);
    expect(canPublishNow(asGroup(fakeGroup('Blocked', groupLifecycleStates.recovering)))).toBe(
      false,
    );
    expect(canPublishNow(asGroup(fakeGroup('Settled', groupLifecycleStates.pendingPublish)))).toBe(
      false,
    );
  });

  it('builds a function intent from the state at submit time, not when called (#1309)', async () => {
    const g = Object.assign(fakeGroup('Syncing'), { state: 'before the wait' });
    setTimeout(() => {
      g.state = 'staged during the wait';
      g.convergenceStatus = 'Settled';
    }, 250);
    const build = jest.fn((group: { state: unknown }) => ({ ...intent, seen: group.state }));
    await submitWhenSettled(asGroup(g), build as never, { timeoutMs: 5_000 });
    expect(build).toHaveBeenCalledTimes(1);
    expect(g.submitIntent).toHaveBeenCalledWith({ ...intent, seen: 'staged during the wait' });
  });
});
