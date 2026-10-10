import { act, renderHook } from '@testing-library/react-native';
import type { NostrProfile } from '../types/nostr';
import { fetchProfile } from '../services/nostrService';
import { useAccountState } from './useAccountState';
import { useOwnProfile } from './useOwnProfile';

jest.mock('../services/nostrService', () => ({ fetchProfile: jest.fn() }));
jest.mock('./nostrCacheKeys', () => ({
  ...jest.requireActual('./nostrCacheKeys'),
  readCachedWithTtl: jest.fn(async () => ({ value: null, ageMs: Infinity })),
}));

it('ignores an own-profile fetch that finishes after an account switch', async () => {
  let finish: (profile: NostrProfile) => void = () => {};
  (fetchProfile as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, rerender } = renderHook(
    ({ owner }: { owner: string }) => {
      const [profile, , setterFor] = useAccountState<NostrProfile | null>(owner, null);
      return { profile, ...useOwnProfile(setterFor) };
    },
    { initialProps: { owner: 'a' } },
  );
  let loading: Promise<void>;
  await act(async () => {
    loading = result.current.loadProfile('a', []);
    await Promise.resolve();
  });
  rerender({ owner: 'b' });
  await act(async () => {
    finish({ name: 'Account A' } as NostrProfile);
    await loading!;
  });
  expect(result.current.profile).toBeNull();
});
