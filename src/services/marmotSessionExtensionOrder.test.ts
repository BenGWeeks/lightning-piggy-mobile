// #1309: White Noise stopped reading a group after a Lightning Piggy rename or
// admin change. OpenMLS (MDK) applies an app_data_update by removing the
// app_data_dictionary extension and re-appending it; ts-mls (marmot-ts)
// replaces it in place. marmot-ts creates groups with the dictionary FIRST, so
// the two derived different GroupContexts and MDK rejected the commit
// ("Confirmation tag mismatch"). Both agree exactly when the dictionary is the
// last GroupContext extension, so every metadata commit must leave it there.
// Real MLS crypto, WebCrypto removed (Hermes has none).
import type { MarmotClient } from '@internet-privacy/marmot-ts';
import type { MarmotSession } from './marmotSession';
import { appDataDictionaryIsLast } from './marmotProposals';
import {
  makeRelay,
  makeSession,
  unwrapWelcomes,
  waitFor,
  waitForSettled,
} from './marmotSessionTestKit';

type Ext = { extensionType: number; extensionData: unknown };

const groupContext = async (session: MarmotSession, appGroupId: string) => {
  const client = (session as unknown as { client: MarmotClient }).client;
  const group = client.groups.loaded.find((g) => appGroupId.endsWith(g.idStr));
  if (!group) throw new Error('group not loaded');
  return group.state.groupContext as unknown as { epoch: bigint; extensions: Ext[] };
};

/** The GroupContext extension order an OpenMLS peer derives after an
 * app_data_update: same extensions, dictionary re-appended at the end. */
const openMlsOrder = (extensions: Ext[]) => [
  ...extensions.filter((e) => e.extensionType !== 6).map((e) => e.extensionType),
  6,
];

describe('MarmotSession metadata commits stay MDK-compatible (#1309)', () => {
  const realSubtle = globalThis.crypto.subtle;
  beforeAll(() =>
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true }),
  );
  afterAll(() =>
    Object.defineProperty(globalThis.crypto, 'subtle', { value: realSubtle, configurable: true }),
  );

  it('aligns the extension order in the first metadata commit, then leaves it alone', async () => {
    const relay = makeRelay();
    const [alice, bob] = [makeSession(relay), makeSession(relay)];
    await Promise.all([alice, bob].map((p) => p.session.start()));
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === bob.pubkey));
    const group = await alice.session.createGroup('Piggy Bank', [bob.pubkey]);
    const [welcome] = unwrapWelcomes(relay, bob);
    expect(await bob.session.acceptWelcome(welcome)).not.toBeNull();

    // marmot-ts creates the dictionary first (MDK puts it last). If this ever
    // fails, marmot-ts creates groups MDK-style and the alignment is a no-op.
    const created = await groupContext(alice.session, group.id);
    expect(appDataDictionaryIsLast(created.extensions)).toBe(false);

    const sent: number[] = [];
    const sendIntent = (alice.session as unknown as { sendIntent: (...a: unknown[]) => unknown })
      .sendIntent;
    jest
      .spyOn(alice.session as unknown as { sendIntent: typeof sendIntent }, 'sendIntent')
      .mockImplementation(function (this: unknown, ...args: unknown[]) {
        const intent = args[1] as { kind: string; extraProposals?: unknown[] };
        if (intent.kind === 'commit') sent.push(intent.extraProposals?.length ?? 0);
        return sendIntent.apply(this, args);
      });

    // Rename: one commit carries the reorder AND the group-profile update.
    await alice.session.rename(group.id, 'Oink Club');
    expect(sent).toEqual([2]);
    const renamed = await groupContext(alice.session, group.id);
    expect(renamed.epoch).toBe(created.epoch + 1n);
    expect(renamed.extensions.map((e) => e.extensionType)).toEqual(
      openMlsOrder(renamed.extensions),
    );
    // Bob (another ts-mls client) accepts it too and lands on the same context.
    await waitFor(() => bob.session.getGroup(group.id)?.name === 'Oink Club');
    expect(await groupContext(bob.session, group.id)).toEqual(renamed);

    // Already aligned: later metadata commits carry no extra proposal.
    await waitForSettled(alice.session, group.id);
    await alice.session.rename(group.id, 'Oink Club II');
    await waitForSettled(alice.session, group.id);
    await alice.session.setAdmins(group.id, (current) => [...current, bob.pubkey]);
    expect(sent).toEqual([2, 1, 1]);
    const final = await groupContext(alice.session, group.id);
    expect(final.extensions.map((e) => e.extensionType)).toEqual(openMlsOrder(final.extensions));
    await waitFor(() => bob.session.getGroup(group.id)?.adminPubkeys.length === 2);
    expect(bob.session.getGroup(group.id)?.name).toBe('Oink Club II');

    for (const p of [alice, bob]) p.session.stop();
  }, 120_000);
});
