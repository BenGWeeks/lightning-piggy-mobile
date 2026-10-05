import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useRelayListEditor } from './useRelayListEditor';
import { fetchLatestReplaceable, publishToRelays } from '../services/nostrRelayLists';

const mockSign = jest.fn();
const mockApply = jest.fn().mockResolvedValue(undefined);
const mockApplyInbox = jest.fn().mockResolvedValue(undefined);
const PUBLISHED = [
  { url: 'wss://relay.primal.net', read: true, write: true },
  { url: 'wss://nostr.land', read: true, write: true },
];
let mockNip65: typeof PUBLISHED = PUBLISHED;
let mockPubkey = 'a'.repeat(64);
let mockInbox: string[] = [];
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({
    pubkey: mockPubkey,
    relays: PUBLISHED,
    nip65Relays: mockNip65,
    dmInboxRelays: mockInbox,
    signEvent: mockSign,
    applyPublishedRelayList: mockApply,
    applyPublishedDmInbox: mockApplyInbox,
  }),
}));
jest.mock('../services/backgroundDmService', () => ({
  rearmBackgroundDmWatchForActiveIdentity: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/nostrRelayLists', () => ({
  fetchLatestReplaceable: jest.fn(),
  publishToRelays: jest.fn(),
}));
const fetchLatest = fetchLatestReplaceable as jest.Mock;
/** Network state per kind: 10002 → relay rows (as r tags), 10050 → inbox URLs. */
let net10002: { url: string; read: boolean; write: boolean }[] | null = null;
let net10050: string[] | null = ['wss://relay.damus.io'];
const asEvent = (kind: number, tags: string[][]) => ({ kind, tags, created_at: 1 });
function mockNetwork() {
  fetchLatest.mockImplementation(async (_pk: string, kind: number) => {
    if (kind === 10002)
      return net10002
        ? asEvent(
            10002,
            net10002.map((r) =>
              r.read && r.write ? ['r', r.url] : ['r', r.url, r.read ? 'read' : 'write'],
            ),
          )
        : null;
    return net10050
      ? asEvent(
          10050,
          net10050.map((u) => ['relay', u]),
        )
      : null;
  });
}
const publish = publishToRelays as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockNip65 = PUBLISHED;
  mockPubkey = 'a'.repeat(64);
  mockInbox = [];
  net10002 = null; // network unchanged / unreachable → keep the cached list
  net10050 = ['wss://relay.damus.io'];
  mockNetwork();
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
  net10002 = fresh;
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
  fetchLatest.mockImplementation((_pk: string, kind: number) =>
    kind === 10002 ? new Promise((r) => (release = r)) : Promise.resolve(null),
  );
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

it("drops the previous account's draft when the identity changes", async () => {
  const h = await setup();
  act(() => {
    h.result.current.addNip65('wss://nostr.mom');
  });
  expect(h.result.current.nip65Dirty).toBe(true);
  mockPubkey = 'c'.repeat(64);
  h.rerender({});
  await waitFor(() => expect(h.result.current.nip65Loading).toBe(false));
  expect(h.result.current.nip65Dirty).toBe(false);
  expect(h.result.current.nip65Draft.some((r) => r.url === 'wss://nostr.mom')).toBe(false);
});

it('falls back to the known inbox list when the lookup fails (never treats it as empty)', async () => {
  mockInbox = ['wss://relay.primal.net', 'wss://nostr.mom'];
  net10050 = null; // lookup failed / timed out
  const { result } = await setup();
  expect(result.current.inboxDraft).toEqual(['wss://relay.primal.net', 'wss://nostr.mom']);
});

it('rejects an event signed by a different identity', async () => {
  mockSign.mockImplementation(async (e: object) => ({
    ...e,
    id: 'id',
    sig: 'sig',
    pubkey: 'c'.repeat(64),
  }));
  const { result } = await setup();
  act(() => {
    result.current.addNip65('wss://nostr.mom');
  });
  await act(async () => {
    expect(await result.current.publishNip65()).toEqual({ ok: false, error: 'not-signed' });
  });
  expect(publish).not.toHaveBeenCalled();
});

it('does not adopt a publish that completes after the user switched accounts', async () => {
  let finish!: (v: unknown) => void;
  publish.mockReturnValue(new Promise((r) => (finish = r)));
  const h = await setup();
  act(() => {
    h.result.current.addNip65('wss://nostr.mom');
  });
  let pending!: Promise<unknown>;
  act(() => {
    pending = h.result.current.publishNip65();
  });
  await waitFor(() => expect(publish).toHaveBeenCalled());
  mockPubkey = 'c'.repeat(64); // switch identity while the publish is in flight
  h.rerender({});
  await act(async () => {
    finish([{ url: 'wss://relay.primal.net', ok: true }]);
    await pending;
  });
  expect(
    mockApply.mock.calls.some((c) =>
      (c[1] as { url: string }[]).some((r) => r.url === 'wss://nostr.mom'),
    ),
  ).toBe(false);
});

it('adopts an inbox list it discovers app-wide, so the app listens there', async () => {
  net10050 = ['wss://relay.primal.net', 'wss://nostr.mom'];
  await setup();
  expect(mockApplyInbox).toHaveBeenCalledWith('a'.repeat(64), [
    'wss://relay.primal.net',
    'wss://nostr.mom',
  ]);
});

it('uses the inbox list the app learns about after the screen opened', async () => {
  net10050 = null; // lookup fails
  mockInbox = [];
  const h = await setup();
  expect(h.result.current.inboxDraft).toEqual([]);
  mockInbox = ['wss://relay.primal.net', 'wss://nostr.mom']; // provider finishes loading later
  h.rerender({});
  await waitFor(() =>
    expect(h.result.current.inboxDraft).toEqual(['wss://relay.primal.net', 'wss://nostr.mom']),
  );
});

it('looks up the inbox list on just-discovered NIP-65 write relays too', async () => {
  net10002 = [{ url: 'wss://new-write.example', read: false, write: true }];
  await setup();
  const inboxCall = fetchLatest.mock.calls.find((c) => c[1] === 10050);
  expect(inboxCall?.[2]).toContain('wss://new-write.example');
});

it('shows one row per relay and lets each permission be toggled independently', async () => {
  mockNip65 = [
    { url: 'wss://nos.lol', read: true, write: false },
    { url: 'wss://nos.lol', read: false, write: true },
  ];
  const { result } = await setup();
  expect(result.current.nip65Draft).toEqual([{ url: 'wss://nos.lol', read: true, write: true }]);
  act(() => {
    result.current.toggleNip65('wss://nos.lol', 'write');
  });
  expect(result.current.nip65Draft).toEqual([{ url: 'wss://nos.lol', read: true, write: false }]);
});
