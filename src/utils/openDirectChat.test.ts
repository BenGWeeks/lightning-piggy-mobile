import { openDirectChat } from './openDirectChat';
import { getMarmotSession } from '../services/marmotSession';

jest.mock('../services/marmotSession', () => ({ getMarmotSession: jest.fn() }));

const findDm = jest.fn();
const canMessage = jest.fn();
const navigate = jest.fn();
const navigation = { navigate };
let peer: string;
let sequence = 0;

beforeEach(() => {
  jest.useFakeTimers();
  // A fresh peer per test so the preferred-protocol cache never leaks across.
  peer = `seller-${sequence++}`;
  navigate.mockReset();
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

const target = () => ({ pubkey: peer, name: 'Seller', picture: null });

test('a peer with a usable key package opens on Marmot', async () => {
  canMessage.mockResolvedValue(true);
  await openDirectChat(navigation, 'viewer', target());
  expect(navigate).toHaveBeenCalledWith('Conversation', { ...target(), protocol: 'marmot' });
});

test('a peer who cannot receive Marmot opens on NIP-17', async () => {
  await openDirectChat(navigation, 'viewer', target());
  expect(navigate).toHaveBeenCalledWith('Conversation', { ...target(), protocol: 'nip17' });
});

test.each(['nip17', 'nip04', 'marmot'] as const)(
  'an explicit %s thread is kept without a lookup',
  async (protocol) => {
    canMessage.mockResolvedValue(protocol !== 'marmot');
    await openDirectChat(navigation, 'viewer', { ...target(), protocol });
    expect(navigate).toHaveBeenCalledWith('Conversation', { ...target(), protocol });
    expect(canMessage).not.toHaveBeenCalled();
  },
);

test('no Marmot session (e.g. Amber / NIP-46 before setup) opens NIP-17 at once', async () => {
  jest.mocked(getMarmotSession).mockReturnValue(null);
  await openDirectChat(navigation, 'viewer', target());
  expect(navigate).toHaveBeenCalledWith('Conversation', { ...target(), protocol: 'nip17' });
  expect(jest.getTimerCount()).toBe(0);
});

test('a slow or offline lookup falls back to NIP-17 within the bounded timeout', async () => {
  canMessage.mockReturnValue(new Promise<boolean>(() => {}));
  const opening = openDirectChat(navigation, 'viewer', target());
  await jest.advanceTimersByTimeAsync(1499);
  expect(navigate).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  await opening;
  expect(navigate).toHaveBeenCalledWith('Conversation', { ...target(), protocol: 'nip17' });
});

test('a double tap shares one lookup and navigates with identical params', async () => {
  // Identical params map to the same Conversation getId, so the stack reuses
  // the first screen instead of pushing a second one.
  let finish!: (value: boolean) => void;
  canMessage.mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)));
  const first = openDirectChat(navigation, 'viewer', target());
  const second = openDirectChat(navigation, 'viewer', target());
  finish(true);
  await Promise.all([first, second]);
  expect(canMessage).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledTimes(2);
  expect(navigate.mock.calls[0]).toEqual(navigate.mock.calls[1]);
  expect(navigate.mock.calls[0][1].protocol).toBe('marmot');
});
