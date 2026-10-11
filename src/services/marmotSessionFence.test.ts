import {
  createStopGate,
  fenceBackend,
  fenceSigner,
  fenceStoppedSessions,
  settleWithin,
  trackStoppedSession,
} from './marmotSessionFence';
import { createMemoryMarmotBackend } from './marmotStore';

describe('marmotSessionFence', () => {
  it('abandons a pending signer request on stop, and discards a late answer', async () => {
    const gate = createStopGate();
    let answer!: (v: string) => void;
    const signer = fenceSigner(
      {
        getPublicKey: () => 'pk',
        signEvent: () => new Promise((resolve) => (answer = resolve as (v: string) => void)),
      } as never,
      gate,
    );
    const pending = signer.signEvent({ kind: 1, created_at: 0, tags: [], content: '' });
    gate.stop();
    answer('signed');
    await expect(pending).rejects.toThrow('session stopped');
    await expect(
      signer.signEvent({ kind: 1, created_at: 0, tags: [], content: '' }),
    ).rejects.toThrow('session stopped');
  });

  it('drops writes only once fenced', async () => {
    const gate = createStopGate();
    const backend = fenceBackend(createMemoryMarmotBackend(), gate);
    await backend.set('ns', 'a', '1');
    gate.stop(); // an account switch: queued writes still land
    await backend.set('ns', 'b', '2');
    gate.fence(); // sign-out wipe
    await backend.set('ns', 'c', '3');
    expect((await backend.keys('ns')).sort()).toEqual(['a', 'b']);
  });

  it.each(['remove', 'clear'] as const)(
    'allows %s until fenced, then preserves a new session’s pending Welcomes',
    async (operation) => {
      const shared = createMemoryMarmotBackend();
      const gate = createStopGate();
      const oldSession = fenceBackend(shared, gate);
      const newSession = fenceBackend(shared, createStopGate());
      const removeWelcome = () =>
        operation === 'remove'
          ? oldSession.remove('pendingWelcomes', 'invite')
          : oldSession.clear('pendingWelcomes');

      await oldSession.set('pendingWelcomes', 'invite', 'original');
      await removeWelcome();
      expect(await shared.get('pendingWelcomes', 'invite')).toBeNull();
      gate.stop();
      await oldSession.set('pendingWelcomes', 'invite', 'queued');
      await removeWelcome();
      expect(await shared.get('pendingWelcomes', 'invite')).toBeNull();

      gate.fence();
      await newSession.set('pendingWelcomes', 'invite', 'retry');
      await newSession.set('pendingWelcomes', 'other', 'another retry');
      await removeWelcome();
      expect(await newSession.get('pendingWelcomes', 'invite')).toBe('retry');
      expect(await newSession.get('pendingWelcomes', 'other')).toBe('another retry');
    },
  );

  it('settleWithin: resolves on settle or timeout, whichever is first', async () => {
    await settleWithin(Promise.reject(new Error('x')), 10_000);
    const started = Date.now();
    await settleWithin(new Promise(() => undefined), 50);
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
  });

  it("fences every stopped session at its account's sign-out, even after tracked work settled", async () => {
    const backend = createMemoryMarmotBackend();
    const settled = createStopGate();
    const other = createStopGate();
    const fenced = fenceBackend(backend, settled);
    settled.stop();
    trackStoppedSession('owner', settled);
    trackStoppedSession('someone-else', other);
    // An untracked late operation (e.g. a Welcome join) still writes after stop…
    await fenced.set('ns', 'a', '1');
    expect(await backend.get('ns', 'a')).toBe('1');
    fenceStoppedSessions('owner');
    expect(settled.fenced).toBe(true);
    expect(other.fenced).toBe(false);
    // …but nothing lands, or is removed, once sign-out has fenced it.
    await fenced.set('ns', 'b', '2');
    await fenced.remove('ns', 'a');
    expect(await backend.get('ns', 'b')).toBeNull();
    expect(await backend.get('ns', 'a')).toBe('1');
  });
});
