import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutedSenders } from './useMutedSenders';
import { toggleMutedSender } from '../services/mutedSenders';
const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const PEER = 'c'.repeat(64);
let mockPubkey = OWNER;
jest.mock('../contexts/NostrContext', () => ({ useNostr: () => ({ pubkey: mockPubkey }) }));

it('hydrates persisted mutes, updates sibling hooks, and hides stale account data on switch', async () => {
  await AsyncStorage.clear();
  await toggleMutedSender(OWNER, PEER);
  const { result, rerender, unmount } = renderHook(() => [useMutedSenders(), useMutedSenders()]);
  await waitFor(() => expect(result.current[0].ready).toBe(true));
  expect(result.current[0].mutedSenders.has(PEER)).toBe(true);
  await act(async () => {
    await result.current[0].toggle(PEER);
  });
  await waitFor(() => expect(result.current[1].mutedSenders.has(PEER)).toBe(false));
  await act(async () => {
    await result.current[0].toggle(PEER);
  });
  await waitFor(() => expect(result.current[1].mutedSenders.has(PEER)).toBe(true));
  mockPubkey = OTHER;
  rerender({});
  expect(result.current[0].mutedSenders.size).toBe(0);
  expect(result.current[0].ready).toBe(false);
  await waitFor(() => expect(result.current[0].ready).toBe(true));
  expect(result.current[0].mutedSenders.size).toBe(0);
  unmount();
  mockPubkey = OWNER;
});
