import { leftAfterReaching, resolveWrapConversation } from './notificationWrapResolver';

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

it("doesn't count the tap's own pending tab switch as the user moving on", () => {
  let route: string | undefined = 'Home';
  const movedOn = leftAfterReaching(() => route, 'Messages');
  expect(movedOn()).toBe(false); // navigate() hasn't landed yet
  route = 'Messages';
  expect(movedOn()).toBe(false);
  route = 'Explore'; // the user left the list
  expect(movedOn()).toBe(true);
});
