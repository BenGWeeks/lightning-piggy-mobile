import { TEST_ACCOUNT_PUBKEYS } from '../utils/testAccounts';
export { TEST_ACCOUNT_PUBKEYS };

export const TEST_RELAY_URL = process.env.EXPO_PUBLIC_TEST_RELAY_URL || 'ws://192.168.1.89:7778';

export const TEST_PUSH_DISABLED = 'push disabled for test accounts in lockdown';

/** Release builds and ordinary accounts keep their original relay behaviour. */
export function isTestRelayLockdown(pubkey: string | null | undefined): boolean {
  return (
    __DEV__ &&
    process.env.EXPO_PUBLIC_TEST_RELAY_LOCKDOWN !== '0' &&
    !!pubkey &&
    TEST_ACCOUNT_PUBKEYS.has(pubkey.toLowerCase())
  );
}

export function lockRelays<T extends readonly string[]>(
  urls: T,
  pubkey: string | null | undefined,
): T | string[] {
  return isTestRelayLockdown(pubkey) ? [TEST_RELAY_URL] : urls;
}
