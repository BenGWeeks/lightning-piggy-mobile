// #1280: a group send made inside marmot-ts's ~1 s convergence-settle window
// (right after a membership commit) is queued by marmot-ts, and only a
// one-shot settle check releases it. When that check misfires, the message
// stayed "sending" forever. These send INSIDE the window and require
// delivery — or a clean failure — never an endless wait.
// Real MLS crypto, WebCrypto removed (Hermes has none).
import { MARMOT_CHAT_KIND, buildMarmotRumor } from './marmotSession';
import { MarmotGroupNotReadyError } from './marmotSendGate';
import { makeRelay, makeSession, unwrapWelcomes, waitFor } from './marmotSessionTestKit';

/** `p`, or a rejection once `ms` pass — so a hang fails the test instead of timing it out. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`still pending after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Alice's group with Bob and Carol, both joined. */
async function groupOfThree() {
  const relay = makeRelay();
  const [alice, bob, carol] = [makeSession(relay), makeSession(relay), makeSession(relay)];
  await Promise.all([alice, bob, carol].map((p) => p.session.start()));
  await waitFor(
    () =>
      relay.events.filter((e) => e.kind === 30443 && [bob.pubkey, carol.pubkey].includes(e.pubkey))
        .length === 2,
  );
  const group = await alice.session.createGroup('Piggy Bank', [bob.pubkey, carol.pubkey]);
  for (const who of [bob, carol]) {
    const [welcome] = unwrapWelcomes(relay, who);
    expect(await who.session.acceptWelcome(welcome)).not.toBeNull();
  }
  return { alice, bob, carol, group };
}

/**
 * marmot-ts times the settle window with performance.now() but wakes with
 * setTimeout. Make performance.now() run `rate`× real time: below 1 the wake
 * lands while the window still reads "not elapsed" (stall mode 1 of #1280,
 * seen in the wild as a ~1 ms early timer), and marmot-ts never re-arms it.
 */
function clockAt(rate: number) {
  // Real time from hrtime: the environment's performance.now reads the global.
  const real = () => Number(process.hrtime.bigint()) / 1e6;
  const [t0, r0] = [performance.now(), real()];
  return jest.spyOn(performance, 'now').mockImplementation(() => t0 + (real() - r0) * rate);
}

describe('MarmotSession sends right after a membership change (#1280, no WebCrypto)', () => {
  const realSubtle = globalThis.crypto.subtle;
  beforeAll(() =>
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true }),
  );
  afterAll(() =>
    Object.defineProperty(globalThis.crypto, 'subtle', { value: realSubtle, configurable: true }),
  );
  afterEach(() => jest.restoreAllMocks());

  it('delivers a message sent inside the settle window after a member removal, even when the settle wake misfires', async () => {
    const { alice, bob, carol, group } = await groupOfThree();
    clockAt(0.97);

    await alice.session.removeMember(group.id, carol.pubkey);
    await waitFor(() => !bob.session.getGroup(group.id)?.memberPubkeys.includes(carol.pubkey));
    // Bob ingested the removal a moment ago: this send is inside his window.
    const msg = buildMarmotRumor(bob.pubkey, { kind: MARMOT_CHAT_KIND, content: 'just us now' });
    const byRelay = await within(bob.session.sendRumor(group.id, msg), 10_000);
    expect(Object.values(byRelay).some(Boolean)).toBe(true);
    await waitFor(() => alice.inbox.some((m) => m.rumor.id === msg.id));
    expect(carol.inbox.some((m) => m.rumor.id === msg.id)).toBe(false);

    for (const p of [alice, bob, carol]) p.session.stop();
  }, 60_000);

  it('fails the send cleanly (retryable) when the group never settles, instead of waiting forever', async () => {
    const { alice, bob, carol, group } = await groupOfThree();
    await alice.session.removeMember(group.id, carol.pubkey);
    await waitFor(() => !bob.session.getGroup(group.id)?.memberPubkeys.includes(carol.pubkey));
    clockAt(0); // frozen: Bob's settle window never elapses

    const msg = buildMarmotRumor(bob.pubkey, { kind: MARMOT_CHAT_KIND, content: 'anyone there?' });
    await expect(
      within(bob.session.sendRumor(group.id, msg, { settleTimeoutMs: 1_500 }), 10_000),
    ).rejects.toThrow(MarmotGroupNotReadyError);
    // Nothing was left queued inside marmot-ts to go out later behind a retry.
    jest.restoreAllMocks();
    await new Promise((r) => setTimeout(r, 1_500));
    expect(alice.inbox.some((m) => m.rumor.id === msg.id)).toBe(false);

    for (const p of [alice, bob, carol]) p.session.stop();
  }, 60_000);
});
