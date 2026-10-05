import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useRelayListEditor } from './useRelayListEditor';
import { fetchDmInboxRelays, publishToRelays } from '../services/nostrRelayLists';
import { fetchRelayList } from '../services/nostrService';

const mockSign = jest.fn();
const mockApply = jest.fn().mockResolvedValue(undefined);
const mockApplyInbox = jest.fn().mockResolvedValue(undefined);
const PUBLISHED = [
  { url: 'wss://relay.primal.net', read: true, write: true },
  { url: 'wss://nostr.land', read: true, write: true },
];
let mockNip65: typeof PUBLISHED = PUBLISHED;
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({
    pubkey: 'a'.repeat(64),
    relays: PUBLISHED,
    nip65Relays: mockNip65,
    signEvent: mockSign,
    applyPublishedRelayList: mockApply,
    applyPublishedDmInbox: mockApplyInbox,
  }),
}));
jest.mock('../services/nostrService', () => ({ fetchRelayList: jest.fn() }));
jest.mock('../services/nostrRelayLists', () => ({
  fetchDmInboxRelays: jest.fn(),
  publishToRelays: jest.fn(),
  // Production waits out the relay keep-open window; tests take the result directly.
  fetchNewest: (start: (onLatest: () => void) => Promise<unknown>) => start(() => {}),
}));
const fetchInbox = fetchDmInboxRelays as jest.Mock;
const fetchFresh = fetchRelayList as jest.Mock;
const publish = publishToRelays as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockNip65 = PUBLISHED;
  fetchInbox.mockResolvedValue(['wss://relay.damus.io']);
  fetchFresh.mockResolvedValue(null); // network unchanged / unreachable → keep the cached list
  mockSign.mockImplementation(async (e: object) => ({
    ...e,
    id: 'id',
    sig: 'sig',
    pubkey: 'a'.repeat(64),
  }));
});

async function setup() {
  const h = renderHook(() => useRelayListEditor());
  await waitFor(() => expect(h.result.current.inboxLoading).toBe(false));
  await waitFor(() => expect(h.result.current.nip65Loading).toBe(false));
  return h;
}

it('removes a published relay, adds one, and publishes a kind 10002 to old + new relays', async () => {
  publish.mockResolvedValue([{ url: 'wss://relay.primal.net', ok: true }]);
  const { result } = await setup();
  act(() => {
    result.current.removeNip65('wss://nostr.land');
    result.current.addNip65('wss://nostr.mom');
  });
  let outcome;
  await act(async () => {
    outcome = await result.current.publishNip65();
  });
  expect(outcome).toMatchObject({ ok: true });
  const signed = mockSign.mock.calls[0][0];
  expect(signed.kind).toBe(10002);
  expect(signed.tags).toEqual([
    ['r', 'wss://relay.primal.net'],
    ['r', 'wss://nostr.mom'],
  ]);
  // The old list is replaced where it lived (nostr.land) as well as on the new relays.
  expect(publish.mock.calls[0][1]).toEqual(
    expect.arrayContaining(['wss://nostr.land', 'wss://nostr.mom', 'wss://purplepag.es']),
  );
  expect(mockApply).toHaveBeenCalledWith('a'.repeat(64), [
    { url: 'wss://relay.primal.net', read: true, write: true },
    { url: 'wss://nostr.mom', read: true, write: true },
  ]);
});

it('refuses to publish an empty list or one with no write relay', async () => {
  const { result } = await setup();
  act(() => {
    result.current.toggleNip65('wss://relay.primal.net', 'write');
    result.current.toggleNip65('wss://nostr.land', 'write');
  });
  await act(async () => {
    expect(await result.current.publishNip65()).toEqual({ ok: false, error: 'no-write' });
  });
  act(() => {
    result.current.removeNip65('wss://relay.primal.net');
    result.current.removeNip65('wss://nostr.land');
  });
  await act(async () => {
    expect(await result.current.publishNip65()).toEqual({ ok: false, error: 'empty' });
  });
  expect(mockSign).not.toHaveBeenCalled();
});

it('rejects local/insecure relays when adding', async () => {
  const { result } = await setup();
  act(() => {
    expect(result.current.addNip65('ws://localhost:10547')).toBe(false);
    expect(result.current.addInbox('ws://relay.example')).toBe(false);
  });
});

it('does not adopt the list when no relay accepted it', async () => {
  publish.mockResolvedValue([{ url: 'wss://relay.primal.net', ok: false, message: 'timed out' }]);
  const { result } = await setup();
  act(() => {
    result.current.addNip65('wss://nostr.mom');
  });
  await act(async () => {
    expect(await result.current.publishNip65()).toMatchObject({
      ok: false,
      error: 'none-accepted',
    });
  });
  expect(mockApply).not.toHaveBeenCalled();
});

it('publishes the DM inbox list as kind 10050', async () => {
  publish.mockResolvedValue([{ url: 'wss://relay.primal.net', ok: true }]);
  const { result } = await setup();
  expect(result.current.inboxDraft).toEqual(['wss://relay.damus.io']);
  act(() => {
    result.current.removeInbox('wss://relay.damus.io');
    result.current.addInbox('wss://nostr.mom');
  });
  await act(async () => {
    expect(await result.current.publishInbox()).toMatchObject({ ok: true });
  });
  expect(mockSign.mock.calls[0][0]).toMatchObject({
    kind: 10050,
    tags: [['relay', 'wss://nostr.mom']],
  });
});

it('reports a declined signature without publishing', async () => {
  mockSign.mockResolvedValue(null);
  const { result } = await setup();
  act(() => {
    result.current.addNip65('wss://nostr.mom');
  });
  await act(async () => {
    expect(await result.current.publishNip65()).toEqual({ ok: false, error: 'not-signed' });
  });
  expect(publish).not.toHaveBeenCalled();
});

it('loads the CURRENT published list before editing, so a stale cache is never published', async () => {
  // The cache says localhost (stale); the network has the list set in another client.
  const fresh = [
    { url: 'wss://relay.primal.net', read: true, write: true },
    { url: 'wss://nostr.mom', read: true, write: true },
  ];
  fetchFresh.mockResolvedValue(fresh);
  const h = renderHook(() => useRelayListEditor());
  expect(h.result.current.nip65Loading).toBe(true);
  await act(async () => {
    // Publishing is blocked while the current list is loading.
    expect(await h.result.current.publishNip65()).toEqual({ ok: false, error: 'not-signed' });
  });
  await waitFor(() => expect(h.result.current.nip65Loading).toBe(false));
  expect(mockApply).toHaveBeenCalledWith('a'.repeat(64), fresh);
  expect(mockSign).not.toHaveBeenCalled();
});

it('blocks edits while the current lists are still loading', async () => {
  let release!: (v: null) => void;
  fetchFresh.mockReturnValue(new Promise((r) => (release = r)));
  const h = renderHook(() => useRelayListEditor());
  expect(h.result.current.nip65Editable).toBe(false);
  act(() => {
    expect(h.result.current.addNip65('wss://nostr.mom')).toBe(false);
  });
  expect(h.result.current.nip65Dirty).toBe(false);
  await act(async () => release(null));
  await waitFor(() => expect(h.result.current.nip65Editable).toBe(true));
});

it('adopts exactly the signed list (non-public rows dropped), not the raw draft', async () => {
  publish.mockResolvedValue([{ url: 'wss://relay.primal.net', ok: true }]);
  // The current list still holds a local relay; it's shown but never published.
  mockNip65 = [
    { url: 'wss://relay.primal.net', read: true, write: true },
    { url: 'ws://localhost:10547', read: true, write: true },
  ];
  const { result } = await setup();
  act(() => {
    result.current.addNip65('wss://nostr.mom');
  });
  await act(async () => {
    await result.current.publishNip65();
  });
  const adopted = mockApply.mock.calls.at(-1)?.[1];
  expect(adopted).toEqual([
    { url: 'wss://relay.primal.net', read: true, write: true },
    { url: 'wss://nostr.mom', read: true, write: true },
  ]);
});

it('starts READING newly published DM inbox relays (so DMs sent there arrive)', async () => {
  publish.mockResolvedValue([{ url: 'wss://relay.primal.net', ok: true }]);
  const { result } = await setup();
  act(() => {
    result.current.addInbox('wss://nostr.mom');
  });
  await act(async () => {
    await result.current.publishInbox();
  });
  expect(mockApplyInbox).toHaveBeenCalledWith('a'.repeat(64), [
    'wss://relay.damus.io',
    'wss://nostr.mom',
  ]);
});

it('freezes editing while a publish is in flight, so no edit is lost', async () => {
  let finish!: (v: unknown) => void;
  publish.mockReturnValue(new Promise((r) => (finish = r)));
  const { result } = await setup();
  act(() => {
    result.current.addNip65('wss://nostr.mom');
  });
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.publishNip65();
  });
  await waitFor(() => expect(result.current.publishing).toBe('nip65'));
  act(() => {
    expect(result.current.addNip65('wss://relay.snort.social')).toBe(false);
  });
  await act(async () => {
    expect(await result.current.publishInbox()).toEqual({ ok: false, error: 'busy' });
  });
  await act(async () => {
    finish([{ url: 'wss://relay.primal.net', ok: true }]);
    await pending;
  });
});
