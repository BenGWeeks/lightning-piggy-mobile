import { MarmotClient } from '@internet-privacy/marmot-ts';
import { MarmotPendingInvitations } from './marmotPendingInvitations';
import { makeRelay, makeSession, unwrapWelcomes, waitFor } from './marmotSessionTestKit';

it('previews a real pending Welcome without consuming its key, then acceptance joins exactly once', async () => {
  const relay = makeRelay();
  const alice = makeSession(relay),
    bob = makeSession(relay);
  try {
    await Promise.all([alice.session.start(), bob.session.start()]);
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === bob.pubkey));
    const created = await alice.session.createGroup('Family', [bob.pubkey]);
    const [welcome] = unwrapWelcomes(relay, bob);
    const invitations = new MarmotPendingInvitations(bob.backend, () => {});
    const join = jest.spyOn(MarmotClient.prototype, 'joinGroupFromWelcome');
    try {
      await invitations.receive('real-wrap', welcome, false);
      await invitations.resume(bob.session, () => true);
      expect((await invitations.list())[0].groupName).toBe('Family');
      expect(bob.session.listGroups()).toEqual([]);
      expect(await bob.backend.keys('pendingWelcomes')).toEqual([]);
      expect(join).not.toHaveBeenCalled();
      const joined = await invitations.accept('real-wrap', bob.session, () => true);
      expect(joined?.id).toBe(created.id);
      expect(join).toHaveBeenCalledTimes(1);
      await invitations.receive('real-wrap', welcome, false);
      await invitations.resume(bob.session, () => true);
      expect(join).toHaveBeenCalledTimes(1);
    } finally {
      join.mockRestore();
    }
  } finally {
    alice.session.stop();
    bob.session.stop();
  }
}, 60_000);
