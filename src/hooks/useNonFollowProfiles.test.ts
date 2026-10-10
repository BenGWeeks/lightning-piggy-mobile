import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NostrContact, NostrProfile } from '../types/nostr';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import { nonFollowProfilesKey, useNonFollowProfiles } from './useNonFollowProfiles';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const PARTNER = 'c'.repeat(64);
const FRIEND = 'd'.repeat(64);

const entry = (partnerPubkey: string): DmInboxEntry => ({
  id: `id-${partnerPubkey.slice(0, 4)}`,
  partnerPubkey,
  fromMe: false,
  createdAt: 1,
  text: 'hi',
  wireKind: 14,
});
const profile = (name: string): NostrProfile =>
  ({ name, picture: `https://x/${name}.png` }) as NostrProfile;

interface Props {
  pubkey: string | null;
  dmInbox: DmInboxEntry[];
  contacts: NostrContact[];
}

function setup(fetchProfilesForPubkeys: (pks: string[]) => Promise<Map<string, NostrProfile>>) {
  return renderHook((props: Props) => useNonFollowProfiles({ ...props, fetchProfilesForPubkeys }), {
    initialProps: { pubkey: A, dmInbox: [entry(PARTNER)], contacts: [] } as Props,
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('useNonFollowProfiles', () => {
  it('keeps a fetched profile when the inbox / contacts re-render mid-fetch', async () => {
    let resolveFetch: (m: Map<string, NostrProfile>) => void = () => {};
    const fetchProfiles = jest.fn(
      () => new Promise<Map<string, NostrProfile>>((r) => (resolveFetch = r)),
    );
    const { result, rerender } = setup(fetchProfiles);
    await waitFor(() => expect(fetchProfiles).toHaveBeenCalledWith([PARTNER]));

    // Contacts land while the kind-0 fetch is still in flight (the post-switch
    // churn that used to cancel the fetch and strand the partner as an npub).
    rerender({
      pubkey: A,
      dmInbox: [entry(PARTNER)],
      contacts: [{ pubkey: FRIEND, profile: profile('friend') } as NostrContact],
    });
    await act(async () => resolveFetch(new Map([[PARTNER, profile('partner')]])));

    expect(result.current.contactInfoMap.get(PARTNER)?.name).toBe('partner');
    expect(fetchProfiles).toHaveBeenCalledTimes(1);
  });

  it('discards a fetch that resolves after an account switch and never persists it under the new account', async () => {
    let resolveFetch: (m: Map<string, NostrProfile>) => void = () => {};
    const fetchProfiles = jest.fn(
      () => new Promise<Map<string, NostrProfile>>((r) => (resolveFetch = r)),
    );
    const { result, rerender } = setup(fetchProfiles);
    await waitFor(() => expect(fetchProfiles).toHaveBeenCalled());

    rerender({ pubkey: B, dmInbox: [], contacts: [] });
    await act(async () => resolveFetch(new Map([[PARTNER, profile('partner')]])));

    expect(result.current.nonFollowProfiles.size).toBe(0);
    expect(await AsyncStorage.getItem(nonFollowProfilesKey(B))).toBeNull();
  });

  it("does not show or copy the previous account's cached profiles after a switch", async () => {
    const fetchProfiles = jest.fn(async () => new Map([[PARTNER, profile('partner')]]));
    const { result, rerender } = setup(fetchProfiles);
    await waitFor(() => expect(result.current.nonFollowProfiles.size).toBe(1));

    rerender({ pubkey: B, dmInbox: [], contacts: [] });
    expect(result.current.nonFollowProfiles.size).toBe(0);
    await act(async () => {});
    expect(await AsyncStorage.getItem(nonFollowProfilesKey(B))).toBeNull();
    expect(await AsyncStorage.getItem(nonFollowProfilesKey(A))).not.toBeNull();
  });

  it('retries a partner after a failed fetch', async () => {
    const fetchProfiles = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(new Map([[PARTNER, profile('partner')]]));
    const { result, rerender } = setup(fetchProfiles);
    await waitFor(() => expect(fetchProfiles).toHaveBeenCalledTimes(1));
    await act(async () => {});

    rerender({ pubkey: A, dmInbox: [entry(PARTNER), entry(PARTNER)], contacts: [] });
    await waitFor(() => expect(result.current.contactInfoMap.get(PARTNER)?.name).toBe('partner'));
    expect(fetchProfiles).toHaveBeenCalledTimes(2);
  });
});
