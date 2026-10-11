// #1309: White Noise stopped reading a group after a Lightning Piggy rename or
// admin change. OpenMLS (MDK) applies an app_data_update by removing the
// app_data_dictionary extension and re-appending it; ts-mls (marmot-ts)
// replaces it in place. marmot-ts creates groups with the dictionary FIRST, so
// the two derived different GroupContexts and MDK rejected the commit
// ("Confirmation tag mismatch"). Both agree exactly when the dictionary is the
// last GroupContext extension, so the session realigns groups in their first
// commit (the founding invite for groups we create). Real MLS crypto, WebCrypto
// removed (Hermes has none).
import { adminPolicyEntry, type MarmotClient } from '@internet-privacy/marmot-ts';
import { appDataUpdateProposalType, defaultProposalTypes } from '@internet-privacy/marmot-ts/mls';
import { MARMOT_GROUP_ID_PREFIX, type MarmotSession } from './marmotSession';
import { appDataDictionaryIsLast } from './marmotProposals';
import {
  makeRelay,
  makeSession,
  RELAY,
  unwrapWelcomes,
  waitFor,
  waitForSettled,
} from './marmotSessionTestKit';

type Ext = { extensionType: number; extensionData: unknown };
type Peer = ReturnType<typeof makeSession>;

const clientOf = (session: MarmotSession) =>
  (session as unknown as { client: MarmotClient }).client;
const loaded = (session: MarmotSession, appGroupId: string) => {
  const group = clientOf(session).groups.loaded.find((g) => appGroupId.endsWith(g.idStr));
  if (!group) throw new Error('group not loaded');
  return group;
};
const groupContext = (session: MarmotSession, appGroupId: string) =>
  loaded(session, appGroupId).state.groupContext as unknown as {
    epoch: bigint;
    extensions: Ext[];
  };

/** The GroupContext extension order an OpenMLS peer derives after an
 * app_data_update: same extensions, dictionary re-appended at the end. */
const openMlsOrder = (extensions: Ext[]) => [
  ...extensions.filter((e) => e.extensionType !== 6).map((e) => e.extensionType),
  6,
];
const expectMdkCompatible = (extensions: Ext[]) =>
  expect(extensions.map((e) => e.extensionType)).toEqual(openMlsOrder(extensions));

/** Proposal count of every commit the session actually submits (after realigning). */
function recordCommits(session: MarmotSession, appGroupId: string): number[] {
  const sent: number[] = [];
  const group = loaded(session, appGroupId);
  const submit = group.submitIntent.bind(group);
  jest.spyOn(group, 'submitIntent').mockImplementation((intent) => {
    if (intent.kind === 'commit') sent.push(intent.extraProposals?.length ?? 0);
    return submit(intent);
  });
  return sent;
}

async function startAll(relay: ReturnType<typeof makeRelay>, peers: Peer[], invitees: Peer[]) {
  await Promise.all(peers.map((p) => p.session.start()));
  await waitFor(
    () =>
      relay.events.filter((e) => e.kind === 30443 && invitees.some((p) => p.pubkey === e.pubkey))
        .length === invitees.length,
  );
}

/** A group in marmot-ts's own extension order, built with the raw client the
 * way groups created before #1309 were (no realigning). */
async function legacyGroup(
  relay: ReturnType<typeof makeRelay>,
  owner: Peer,
  members: Peer[],
  adminPubkeys: string[],
): Promise<string> {
  const client = clientOf(owner.session);
  const group = await client.groups.create('Legacy', {
    description: '',
    relays: [RELAY],
    adminPubkeys,
  });
  for (const m of members) {
    const kp = relay.events.find((e) => e.kind === 30443 && e.pubkey === m.pubkey)!;
    await client.groups.invite(group.id, kp);
    const [welcome] = unwrapWelcomes(relay, m);
    expect(await m.session.acceptWelcome(welcome)).not.toBeNull();
  }
  const appGroupId = MARMOT_GROUP_ID_PREFIX + group.idStr;
  for (const m of members) {
    await waitFor(() => m.session.getGroup(appGroupId)?.memberPubkeys.length === members.length);
  }
  expect(appDataDictionaryIsLast(groupContext(owner.session, appGroupId).extensions)).toBe(false);
  return appGroupId;
}

describe('Marmot groups stay MDK-compatible across metadata commits (#1309)', () => {
  const realSubtle = globalThis.crypto.subtle;
  beforeAll(() =>
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true }),
  );
  afterAll(() =>
    Object.defineProperty(globalThis.crypto, 'subtle', { value: realSubtle, configurable: true }),
  );

  it('aligns a group we create in its founding invite; later commits add nothing', async () => {
    const relay = makeRelay();
    const [alice, bob] = [makeSession(relay), makeSession(relay)];
    await startAll(relay, [alice, bob], [bob]);
    const group = await alice.session.createGroup('Piggy Bank', [bob.pubkey]);
    const [welcome] = unwrapWelcomes(relay, bob);
    expect(await bob.session.acceptWelcome(welcome)).not.toBeNull();

    // Aligned before anyone else (a White Noise admin, say) can commit.
    const created = groupContext(alice.session, group.id);
    expectMdkCompatible(created.extensions);
    expect(groupContext(bob.session, group.id)).toEqual(created);

    // Already aligned (like a White Noise-created group): nothing extra.
    const sent = recordCommits(alice.session, group.id);
    await alice.session.rename(group.id, 'Oink Club');
    await waitForSettled(alice.session, group.id);
    await alice.session.setAdmins(group.id, (current) => [...current, bob.pubkey]);
    expect(sent).toEqual([1, 1]);
    const final = groupContext(alice.session, group.id);
    expectMdkCompatible(final.extensions);
    await waitFor(() => bob.session.getGroup(group.id)?.adminPubkeys.length === 2);
    expect(bob.session.getGroup(group.id)?.name).toBe('Oink Club');
    expect(groupContext(bob.session, group.id)).toEqual(final);

    for (const p of [alice, bob]) p.session.stop();
  }, 120_000);

  it('migrates an existing group in its first metadata commit (an admin removal)', async () => {
    const relay = makeRelay();
    const [alice, bob, carol] = [makeSession(relay), makeSession(relay), makeSession(relay)];
    await startAll(relay, [alice, bob, carol], [bob, carol]);
    const id = await legacyGroup(relay, alice, [bob, carol], [alice.pubkey, bob.pubkey]);

    const sent = recordCommits(alice.session, id);
    // marmot-ts splices the admin-policy update into this Remove commit itself.
    await alice.session.removeMember(id, bob.pubkey);
    expect(sent).toEqual([2]); // realign + Remove
    const after = groupContext(alice.session, id);
    expectMdkCompatible(after.extensions);
    expect(alice.session.getGroup(id)?.adminPubkeys).toEqual([alice.pubkey]);
    await waitFor(() => carol.session.getGroup(id)?.adminPubkeys.length === 1);
    expect(groupContext(carol.session, id)).toEqual(after);

    await waitForSettled(alice.session, id);
    await alice.session.rename(id, 'Oink Club');
    expect(sent).toEqual([2, 1]);

    for (const p of [alice, bob, carol]) p.session.stop();
  }, 120_000);

  it.each([
    ['app_data_update', appDataUpdateProposalType],
    ['GroupContextExtensions', defaultProposalTypes.group_context_extensions],
  ])(
    "doesn't realign while a peer's %s proposal is staged, and the commit still lands",
    async (_name, proposalType) => {
      const relay = makeRelay();
      const [alice, bob] = [makeSession(relay), makeSession(relay)];
      await startAll(relay, [alice, bob], [bob]);
      const admins = [alice.pubkey, bob.pubkey];
      const id = await legacyGroup(relay, alice, [bob], admins);

      // Bob (an admin) stages a standalone proposal, as MDK admins may.
      const bobGroup = loaded(bob.session, id);
      const proposal =
        proposalType === appDataUpdateProposalType
          ? (() => {
              const entry = adminPolicyEntry(admins);
              const appDataUpdate = {
                componentId: entry.componentId,
                operation: 'update' as const,
                update: entry.data,
              };
              return { proposalType: appDataUpdateProposalType, appDataUpdate };
            })()
          : {
              proposalType: defaultProposalTypes.group_context_extensions,
              groupContextExtensions: { extensions: bobGroup.state.groupContext.extensions },
            };
      await waitForSettled(bob.session, id);
      await bobGroup.submitIntent({ kind: 'proposal', proposal } as never);
      const aliceGroup = loaded(alice.session, id);
      await waitFor(() => Object.keys(aliceGroup.state.unappliedProposals).length === 1);
      await waitForSettled(alice.session, id);

      const sent = recordCommits(alice.session, id);
      await alice.session.rename(id, 'Oink Club'); // bundles Bob's proposal by reference
      expect(sent).toEqual([1]);
      await waitFor(() => bob.session.getGroup(id)?.name === 'Oink Club');
      expect(Object.keys(aliceGroup.state.unappliedProposals)).toHaveLength(0);

      // Nothing staged any more: the next commit realigns.
      await waitForSettled(alice.session, id);
      await alice.session.rename(id, 'Oink Club II');
      expect(sent).toEqual([1, 2]);
      expectMdkCompatible(groupContext(alice.session, id).extensions);
      await waitFor(() => bob.session.getGroup(id)?.name === 'Oink Club II');
      expect(groupContext(bob.session, id)).toEqual(groupContext(alice.session, id));

      for (const p of [alice, bob]) p.session.stop();
    },
    120_000,
  );
});
