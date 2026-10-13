import { MarmotPendingInvitations } from './marmotPendingInvitations';
import type { MarmotRumor } from './marmotSession';
import { createMemoryMarmotBackend } from './marmotStore';
jest.mock('./localDb', () => ({ getLocalDb: jest.fn() }));

const rumor: MarmotRumor = {
  id: 'rumor',
  pubkey: 'b'.repeat(64),
  kind: 444,
  content: 'secret welcome',
  tags: [],
  created_at: 1,
};
const group = {
  id: 'group',
  name: 'Family',
  memberPubkeys: [],
  adminPubkeys: [],
  createdAt: 1,
  isDm: false,
};
function setup() {
  const backend = createMemoryMarmotBackend();
  const changed = jest.fn();
  const invitations = new MarmotPendingInvitations(backend, changed);
  const session = {
    acceptWelcome: jest.fn().mockResolvedValue(group),
    previewWelcome: jest.fn().mockResolvedValue({ group: { name: 'Family' } }),
  };
  return { backend, invitations, session };
}

it('persists a stranger as pending across restart and previews without joining or consuming a key', async () => {
  const { backend, invitations, session } = setup();
  expect(await invitations.receive('wrap', rumor, false)).toBe(true);
  await invitations.resume(session, () => true);
  expect(session.acceptWelcome).not.toHaveBeenCalled();
  expect(await new MarmotPendingInvitations(backend, jest.fn()).list()).toEqual([
    expect.objectContaining({ id: 'wrap', rumor, groupName: 'Family', status: 'pending' }),
  ]);
  // Hydrated contacts or a later permissive backfill cannot grant consent.
  await invitations.receive('wrap', rumor, true);
  await invitations.resume(session, () => true);
  expect(session.acceptWelcome).not.toHaveBeenCalled();
});
it('joins a followed invitation through the existing consumption logic', async () => {
  const { invitations, session } = setup();
  await invitations.receive('wrap', rumor, true);
  await invitations.resume(session, () => true);
  expect(session.acceptWelcome).toHaveBeenCalledWith(rumor);
  expect(await invitations.list()).toEqual([]);
});
it('explicit acceptance joins and returns the group to open', async () => {
  const { invitations, session } = setup();
  await invitations.receive('wrap', rumor, false);
  expect(await invitations.accept('wrap', session, () => true)).toEqual(group);
  expect(session.acceptWelcome).toHaveBeenCalledTimes(1);
  expect(await invitations.list()).toEqual([]);
});
it('decline discards plaintext and dedupes even after a restart', async () => {
  const { backend, invitations, session } = setup();
  await invitations.receive('wrap', rumor, false);
  await invitations.decline('wrap');
  expect(await backend.get('welcomeInvitations', 'wrap')).toBe(
    JSON.stringify({ id: 'wrap', status: 'declined' }),
  );
  const restarted = new MarmotPendingInvitations(backend, jest.fn());
  expect(await restarted.receive('wrap', rumor, false)).toBe(false);
  await restarted.resume(session, () => true);
  expect(await restarted.list()).toEqual([]);
  expect(session.acceptWelcome).not.toHaveBeenCalled();
});
it('concurrent live/backfill delivery of one wrap processes it exactly once', async () => {
  const { invitations, session } = setup();
  await Promise.all([
    invitations.receive('wrap', rumor, true),
    invitations.receive('wrap', rumor, true),
  ]);
  await Promise.all([
    invitations.resume(session, () => true),
    invitations.resume(session, () => true),
  ]);
  expect(session.acceptWelcome).toHaveBeenCalledTimes(1);
});
it('durable acceptance retries after restart but never retries unapproved invitations', async () => {
  const { backend, invitations, session } = setup();
  session.acceptWelcome.mockResolvedValueOnce(null);
  await invitations.receive('approved', rumor, false);
  await invitations.receive('stranger', { ...rumor, id: 'other-rumor' }, false);
  await invitations.accept('approved', session, () => true);
  const restarted = new MarmotPendingInvitations(backend, jest.fn());
  await restarted.resume(session, () => true);
  expect(session.acceptWelcome).toHaveBeenCalledTimes(2);
  expect((await restarted.list()).map((i) => i.id)).toEqual(['stranger']);
});
it('does not accept into a different account session', async () => {
  const { invitations, session } = setup();
  await invitations.receive('wrap', rumor, false);
  expect(await invitations.accept('wrap', session, () => false)).toBeNull();
  expect(session.acceptWelcome).not.toHaveBeenCalled();
  expect(await invitations.list()).toHaveLength(1);
});

it('does not re-prompt a declined Welcome rewrapped under a different outer id', async () => {
  const { backend, invitations, session } = setup();
  await invitations.receive('first-wrap', rumor, false);
  await invitations.decline('first-wrap');
  const restarted = new MarmotPendingInvitations(backend, jest.fn());
  expect(await restarted.receive('new-wrap', rumor, false)).toBe(false);
  await restarted.resume(session, () => true);
  expect(await restarted.list()).toEqual([]);
  expect(session.acceptWelcome).not.toHaveBeenCalled();
});
