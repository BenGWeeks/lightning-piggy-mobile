import {
  isTestRelayLockdown,
  lockRelays,
  TEST_ACCOUNT_PUBKEYS,
  TEST_RELAY_URL,
} from './testRelayLockdown';

const pubkey = [...TEST_ACCOUNT_PUBKEYS][0];
const urls = ['wss://public.example', 'wss://other.example'];
const originalDev = __DEV__;
const originalOverride = process.env.EXPO_PUBLIC_TEST_RELAY_LOCKDOWN;
afterEach(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = originalDev;
  if (originalOverride === undefined) delete process.env.EXPO_PUBLIC_TEST_RELAY_LOCKDOWN;
  else process.env.EXPO_PUBLIC_TEST_RELAY_LOCKDOWN = originalOverride;
});
it('locks all four known accounts, including uppercase input and empty relay lists', () => {
  expect(TEST_ACCOUNT_PUBKEYS.size).toBe(4);
  for (const key of TEST_ACCOUNT_PUBKEYS) {
    expect(isTestRelayLockdown(key.toUpperCase())).toBe(true);
    expect(lockRelays(urls, key)).toEqual([TEST_RELAY_URL]);
    expect(lockRelays([], key)).toEqual([TEST_RELAY_URL]);
  }
});
it.each([null, undefined, 'a'.repeat(64)])('preserves the original list for %s', (key) => {
  expect(lockRelays(urls, key)).toBe(urls);
});
it('preserves release behaviour even for test accounts', () => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
  expect(isTestRelayLockdown(pubkey)).toBe(false);
  expect(lockRelays(urls, pubkey)).toBe(urls);
});
it('allows explicit interop override in DEV', () => {
  process.env.EXPO_PUBLIC_TEST_RELAY_LOCKDOWN = '0';
  expect(lockRelays(urls, pubkey)).toBe(urls);
});
