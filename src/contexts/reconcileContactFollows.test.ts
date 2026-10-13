import { fetchFollowSnapshot, adoptFollowSnapshot } from '../services/contactFollowFreshness';
import { reconcileContactFollows } from './reconcileContactFollows';
jest.mock('../services/contactFollowFreshness', () => ({
  readFollowSnapshot: jest.fn(async () => ({ contacts: [], createdAt: 100 })),
  fetchFollowSnapshot: jest.fn(),
  adoptFollowSnapshot: jest.fn(async (_owner, snapshot) => snapshot),
}));
jest.mock('../services/nostrRelayStorage', () => ({ getUserRelays: jest.fn(async () => []) }));

it('publishes readiness after the round-1 adoption completes, never after the cache read', async () => {
  let resolve!: (value: null) => void;
  jest.mocked(fetchFollowSnapshot).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const paint = jest.fn();
  const finish = jest.fn();
  const pending = reconcileContactFollows('owner', [], null, paint, finish);
  await new Promise((r) => setImmediate(r));
  expect(paint).toHaveBeenCalledWith([]);
  expect(finish).not.toHaveBeenCalled();
  resolve(null);
  await pending;
  expect(finish).toHaveBeenCalledWith([]);
});

it('finishes with the adopted reconciled follows', async () => {
  const fresh = {
    createdAt: 200,
    contacts: [{ pubkey: 'a'.repeat(64), relay: null, petname: null, profile: null }],
  };
  jest.mocked(fetchFollowSnapshot).mockResolvedValueOnce(fresh);
  const finish = jest.fn();
  await reconcileContactFollows('owner', [], null, jest.fn(), finish);
  expect(adoptFollowSnapshot).toHaveBeenCalledWith('owner', fresh);
  expect(finish).toHaveBeenCalledWith(fresh.contacts);
});
