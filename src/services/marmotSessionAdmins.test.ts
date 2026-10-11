// Group admins (MIP-01 `admin_pubkeys` / admin-policy-v1): an admin promotes
// a member, the new admin's authority is honoured by the other members, the
// session refuses an empty or non-member admin set, and removing an admin
// drops them from `admins` in the same commit. Real MLS crypto, WebCrypto
// removed (Hermes has none).
import { LastAdminError } from '../utils/groupAdmins';
import {
  makeRelay,
  makeSession,
  unwrapWelcomes,
  waitFor,
  waitForSettled,
} from './marmotSessionTestKit';

const sorted = (pks: string[]) => [...pks].sort();

describe('MarmotSession group admins (no WebCrypto)', () => {
  const realSubtle = globalThis.crypto.subtle;
  beforeAll(() =>
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true }),
  );
  afterAll(() =>
    Object.defineProperty(globalThis.crypto, 'subtle', { value: realSubtle, configurable: true }),
  );

  it('promotes, enforces the admin-set rules, and drops a removed admin', async () => {
    const relay = makeRelay();
    const [alice, bob, carol] = [makeSession(relay), makeSession(relay), makeSession(relay)];
    await Promise.all([alice, bob, carol].map((p) => p.session.start()));
    await waitFor(
      () =>
        relay.events.filter(
          (e) => e.kind === 30443 && [bob.pubkey, carol.pubkey].includes(e.pubkey),
        ).length === 2,
    );
    const group = await alice.session.createGroup('Piggy Bank', [bob.pubkey, carol.pubkey]);
    expect(group.adminPubkeys).toEqual([alice.pubkey]);
    for (const who of [bob, carol]) {
      const [welcome] = unwrapWelcomes(relay, who);
      expect(await who.session.acceptWelcome(welcome)).not.toBeNull();
    }

    // Make Bob an admin; every member sees it.
    await alice.session.setAdmins(group.id, (current) => [...current, bob.pubkey]);
    const both = sorted([alice.pubkey, bob.pubkey]);
    expect(sorted(alice.session.getGroup(group.id)!.adminPubkeys)).toEqual(both);
    await waitFor(() => bob.session.getGroup(group.id)?.adminPubkeys.length === 2);
    await waitFor(() => carol.session.getGroup(group.id)?.adminPubkeys.length === 2);
    expect(sorted(carol.session.getGroup(group.id)!.adminPubkeys)).toEqual(both);

    // Bob's new authority is accepted: his rename lands for the others.
    await waitForSettled(bob.session, group.id);
    await bob.session.rename(group.id, 'Oink Club');
    await waitFor(() => alice.session.getGroup(group.id)?.name === 'Oink Club');

    // Never an empty admin set, never a non-member.
    await waitForSettled(alice.session, group.id);
    await expect(alice.session.setAdmins(group.id, () => [])).rejects.toBeInstanceOf(
      LastAdminError,
    );
    await expect(
      alice.session.setAdmins(group.id, (current) => [...current, 'f'.repeat(64)]),
    ).rejects.toThrow(/must be a member/);

    // Removing an admin takes them out of `admins` in the same commit (an
    // admin with no leaf is invalid; marmot-ts splices that update in).
    await alice.session.removeMember(group.id, bob.pubkey);
    expect(alice.session.getGroup(group.id)).toMatchObject({
      memberPubkeys: [carol.pubkey],
      adminPubkeys: [alice.pubkey],
    });
    await waitFor(() => carol.session.getGroup(group.id)?.adminPubkeys.length === 1);
    expect(carol.session.getGroup(group.id)?.adminPubkeys).toEqual([alice.pubkey]);

    for (const p of [alice, bob, carol]) p.session.stop();
  }, 120_000);
});
