import { preferredConversationParams, preferredDmProtocol } from './preferredDmProtocol';
import { getMarmotSession } from './marmotSession';

jest.mock('./marmotSession', () => ({ getMarmotSession: jest.fn() }));

const findDm = jest.fn();
const canMessage = jest.fn();
let peer: string;
let sequence = 0;

beforeEach(() => {
  jest.useFakeTimers();
  peer = `peer-${sequence++}`;
  findDm.mockReset().mockReturnValue(undefined);
  canMessage.mockReset().mockResolvedValue(false);
  jest.mocked(getMarmotSession).mockReturnValue({
    pubkey: 'viewer',
    ready: Promise.resolve(),
    findDm,
    canMessage,
  } as unknown as NonNullable<ReturnType<typeof getMarmotSession>>);
});

afterEach(() => jest.useRealTimers());

test('existing Marmot 1:1 wins without querying relays', async () => {
  findDm.mockReturnValue({ id: 'secure-dm' });
  expect(await preferredDmProtocol('viewer', peer)).toBe('marmot');
  expect(canMessage).not.toHaveBeenCalled();
});

test('a usable key package selects Marmot', async () => {
  canMessage.mockResolvedValue(true);
  expect(await preferredDmProtocol('viewer', peer)).toBe('marmot');
  expect(canMessage).toHaveBeenCalledWith(peer);
  expect(jest.getTimerCount()).toBe(0);
});

test('no usable invitation keys selects NIP-17', async () => {
  expect(await preferredDmProtocol('viewer', peer)).toBe('nip17');
});

test('lookup timeout falls back after 1.5 seconds; late success cannot change the choice', async () => {
  let finish!: (value: boolean) => void;
  canMessage.mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)));
  const result = preferredDmProtocol('viewer', peer);
  await jest.advanceTimersByTimeAsync(1500);
  expect(await result).toBe('nip17');
  finish(true);
  await Promise.resolve();
  expect(await preferredDmProtocol('viewer', peer)).toBe('nip17');
});

test('session loading is included in the deadline', async () => {
  jest.mocked(getMarmotSession).mockReturnValue({
    pubkey: 'viewer',
    ready: new Promise(() => {}),
    findDm,
    canMessage,
  } as unknown as NonNullable<ReturnType<typeof getMarmotSession>>);
  const result = preferredDmProtocol('viewer', peer);
  await jest.advanceTimersByTimeAsync(1500);
  expect(await result).toBe('nip17');
  expect(canMessage).not.toHaveBeenCalled();
});

test.each(['nip17', 'nip04', 'marmot'] as const)('caller override %s wins', async (protocol) => {
  findDm.mockReturnValue({ id: 'secure-dm' });
  expect(await preferredDmProtocol('viewer', peer, protocol)).toBe(protocol);
  expect(findDm).not.toHaveBeenCalled();
  expect(canMessage).not.toHaveBeenCalled();
});

test.each([
  [true, 'marmot', 10 * 60_000],
  [false, 'nip17', 2 * 60_000],
] as const)('cache hit and expiry (supported=%s)', async (supported, protocol, ttl) => {
  canMessage.mockResolvedValue(supported);
  expect(await preferredDmProtocol('viewer', peer)).toBe(protocol);
  await jest.advanceTimersByTimeAsync(ttl - 1);
  expect(await preferredDmProtocol('VIEWER', peer.toUpperCase())).toBe(protocol);
  expect(canMessage).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(await preferredDmProtocol('viewer', peer)).toBe(protocol);
  expect(canMessage).toHaveBeenCalledTimes(2);
});

test('concurrent lookups share a query', async () => {
  canMessage.mockResolvedValue(true);
  expect(
    await Promise.all([preferredDmProtocol('viewer', peer), preferredDmProtocol('viewer', peer)]),
  ).toEqual(['marmot', 'marmot']);
  expect(canMessage).toHaveBeenCalledTimes(1);
});

test('an existing DM takes precedence over a cached negative lookup', async () => {
  expect(await preferredDmProtocol('viewer', peer)).toBe('nip17');
  findDm.mockReturnValue({ id: 'new-secure-dm' });
  expect(await preferredDmProtocol('viewer', peer)).toBe('marmot');
});

test('lookup errors use NIP-17', async () => {
  canMessage.mockRejectedValue(new Error('offline'));
  expect(await preferredDmProtocol('viewer', peer)).toBe('nip17');
});

test('another account cannot use the active session', async () => {
  findDm.mockReturnValue({ id: 'secure-dm' });
  expect(await preferredDmProtocol('other-viewer', peer)).toBe('nip17');
  expect(findDm).not.toHaveBeenCalled();
});

test('no active session uses NIP-17', async () => {
  jest.mocked(getMarmotSession).mockReturnValue(null);
  expect(await preferredDmProtocol('viewer', peer)).toBe('nip17');
  expect(await preferredDmProtocol(null, peer)).toBe('nip17');
});

test('navigation params open the preferred thread', async () => {
  canMessage.mockResolvedValue(true);
  const target = { pubkey: peer, name: 'Middle Piggy', picture: null };
  expect(await preferredConversationParams('viewer', target)).toEqual({
    ...target,
    protocol: 'marmot',
  });
});

test('navigation params preserve an explicit open thread', async () => {
  const target = { pubkey: peer, name: 'Middle Piggy', protocol: 'nip17' as const };
  expect(await preferredConversationParams('viewer', target)).toEqual(target);
  expect(canMessage).not.toHaveBeenCalled();
});
