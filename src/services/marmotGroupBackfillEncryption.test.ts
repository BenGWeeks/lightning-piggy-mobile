import { MarmotSession, buildMarmotRumor } from './marmotSession';
import {
  RELAY,
  makeRelay,
  makeSession,
  unwrapWelcomes,
  waitFor,
  waitForSettled,
} from './marmotSessionTestKit';

// Real MLS encryption and durable in-memory state, with relay delivery newest-first.
describe('Marmot offline group backfill ordering', () => {
  it.each([false, true])(
    'decrypts all 25 sender generations in order (epoch change: %s)',
    async (changeEpoch) => {
      const relay = makeRelay();
      const alice = makeSession(relay);
      const firstBob = makeSession(relay, 7);
      let bob: MarmotSession | undefined;
      const subscription = jest.spyOn(relay.network, 'subscription');
      const realNow = Date.now;
      let timestamp = realNow() - 120_000;
      let clock: jest.SpyInstance | undefined;
      try {
        await alice.session.start();
        await firstBob.session.start();
        await waitFor(() =>
          relay.events.some((e) => e.kind === 30443 && e.pubkey === firstBob.pubkey),
        );
        const group = await alice.session.createGroup('Offline catch-up', [firstBob.pubkey]);
        await firstBob.session.acceptWelcome(unwrapWelcomes(relay, firstBob)[0]);
        await waitForSettled(firstBob.session, group.id);
        firstBob.session.stop();

        // Separate transport seconds force newest-first relay paging. No fake timers:
        // convergence and the budget-paced scheduler still use the real event loop.
        clock = jest.spyOn(Date, 'now').mockImplementation(() => timestamp);
        const expected: string[] = [];
        for (let i = 0; i < 25; i++) {
          if (changeEpoch && i === 13) {
            timestamp += 1000;
            await alice.session.rename(group.id, 'New epoch');
            // Deliberately date epoch-2 traffic BEFORE epoch-1 traffic. The
            // encrypted MLS epoch, not the transport timestamp, controls ingestion.
            timestamp -= 60_000;
          }
          timestamp += 1000;
          const rumor = buildMarmotRumor(alice.pubkey, { kind: 9, content: `offline ${i}` });
          expected.push(rumor.id);
          await alice.session.sendRumor(group.id, rumor);
        }
        clock.mockRestore();
        clock = undefined;

        const inbox: string[] = [];
        bob = new MarmotSession({
          pubkey: firstBob.pubkey,
          signerType: 'nsec',
          signer: firstBob.signer,
          network: relay.network,
          backend: firstBob.backend,
          getWriteRelays: () => [RELAY],
          getLookupRelays: () => [RELAY],
          groupBackfillPageSize: 7,
        });
        bob.subscribe({ onMessage: (m) => inbox.push(m.rumor.id) });
        subscription.mockClear();
        await bob.start();
        // The group live subscription opens only AFTER the complete backfill drains.
        await waitFor(() =>
          subscription.mock.calls.some(([, filters]) =>
            (Array.isArray(filters) ? filters : [filters]).some((f) => f.kinds?.includes(445)),
          ),
        );
        expect(inbox).toEqual(expected);
        expect(
          relay.requests.flat().some((f) => f.kinds?.includes(445) && f.until !== undefined),
        ).toBe(true);
      } finally {
        clock?.mockRestore();
        subscription.mockRestore();
        alice.session.stop();
        firstBob.session.stop();
        bob?.stop();
      }
    },
    90_000,
  );
});
