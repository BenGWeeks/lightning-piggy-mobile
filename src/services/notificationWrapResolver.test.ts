import {
  createRouteLeaveTracker,
  isForAnotherAccount,
  resolveWrapConversation,
} from './notificationWrapResolver';

const PK = 'a'.repeat(64);
const PARTNER = 'b'.repeat(64);

it('resolves a wrap once the app has stored its decrypted message (#1154)', async () => {
  let calls = 0;
  const lookup = jest.fn(async () =>
    ++calls < 3 ? null : { conversation: PARTNER, wireKind: 14 },
  );
  await expect(resolveWrapConversation(PK, 'wrap', { intervalMs: 1, lookup })).resolves.toEqual({
    pubkey: PARTNER,
    protocol: 'nip17',
  });
  expect(lookup).toHaveBeenCalledWith(PK, 'wrap');
});

it('gives up after the timeout, or as soon as the result is no longer wanted', async () => {
  const lookup = jest.fn(async () => null);
  await expect(
    resolveWrapConversation(PK, 'wrap', { timeoutMs: 20, intervalMs: 5, lookup }),
  ).resolves.toBeNull();
  await expect(
    resolveWrapConversation(PK, 'wrap', { lookup, shouldStop: () => true }),
  ).resolves.toBeNull();
});

it("doesn't count the tap's own pending tab switch as moving on, but sees any later leave", () => {
  const tracker = createRouteLeaveTracker('Messages');
  tracker.onRoute('Home'); // navigate() hasn't landed yet
  expect(tracker.movedOn()).toBe(false);
  tracker.onRoute('Messages');
  expect(tracker.movedOn()).toBe(false);
  tracker.onRoute('Explore'); // left — recorded at the transition, not at a poll
  tracker.onRoute('Messages'); // even if they come back before the next poll
  expect(tracker.movedOn()).toBe(true);
});

it('treats a message alert for another signed-in account as not openable here', () => {
  expect(isForAnotherAccount({ kind: 'dm', owner: PK }, PARTNER)).toBe(true);
  expect(isForAnotherAccount({ kind: 'group', owner: PK }, PARTNER)).toBe(true);
  expect(isForAnotherAccount({ kind: 'dm', owner: PK.toUpperCase() }, PK)).toBe(false);
  expect(isForAnotherAccount({ kind: 'dm' }, PK)).toBe(false); // older alerts: no owner
  expect(isForAnotherAccount({ kind: 'payment', owner: PK }, PARTNER)).toBe(false);
});
