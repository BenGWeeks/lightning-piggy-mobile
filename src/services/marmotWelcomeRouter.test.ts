import type { MarmotKvBackend } from './marmotStore';
import type { DecodedRumor } from '../utils/nip17Unwrap';
import { routeMarmotWelcome } from './marmotWelcomeRouter';
import { fireMessageNotification } from './notificationService';

const mockBackends = new Map<string, MarmotKvBackend>();
const mockAccept = jest.fn().mockResolvedValue({ id: 'joined-group' });
const mockPreview = jest.fn().mockResolvedValue({ group: { name: 'Private family' } });
let mockSession: {
  pubkey: string;
  acceptWelcome: typeof mockAccept;
  previewWelcome: typeof mockPreview;
} | null = null;
let mockSessionChanged: (s: typeof mockSession) => void;
jest.mock('./marmotSession', () => ({
  getMarmotSession: () => mockSession,
  subscribeMarmotSession: (listener: typeof mockSessionChanged) => {
    mockSessionChanged = listener;
  },
}));
jest.mock('./localDb', () => ({ getLocalDb: jest.fn() }));
jest.mock('./marmotStore', () => {
  const actual = jest.requireActual('./marmotStore');
  return {
    ...actual,
    createSqliteMarmotBackend: (owner: string) => {
      if (!mockBackends.has(owner)) mockBackends.set(owner, actual.createMemoryMarmotBackend());
      return mockBackends.get(owner);
    },
  };
});
jest.mock('./notificationService', () => ({
  fireMessageNotification: jest.fn().mockResolvedValue('notification'),
}));
jest.mock('./dmWrapNotificationDedupe', () => ({
  claimWrapNotification: jest.fn().mockReturnValue(true),
}));

const rumor: DecodedRumor = {
  kind: 444,
  pubkey: 'b'.repeat(64),
  created_at: 100,
  content: 'secret MLS payload',
  tags: [],
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = null;
  mockSessionChanged(null);
});

it('stores a cold-start stranger durably, then previews without joining when Marmot starts', async () => {
  const owner = 'a'.repeat(64);
  await routeMarmotWelcome(rumor, owner, 'cold-wrap', false, true);
  expect(await mockBackends.get(owner)!.get('welcomeInvitations', 'cold-wrap')).toContain(
    '"status":"pending"',
  );
  mockSession = { pubkey: owner, acceptWelcome: mockAccept, previewWelcome: mockPreview };
  mockSessionChanged(mockSession);
  await settle();
  expect(mockAccept).not.toHaveBeenCalled();
  expect(mockPreview).toHaveBeenCalledTimes(1);
  expect(fireMessageNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      owner,
      title: 'New group invitation',
      body: 'New group invitation',
      data: { groupInvitation: true, senderPubkey: rumor.pubkey },
    }),
  );
  expect(JSON.stringify((fireMessageNotification as jest.Mock).mock.calls)).not.toContain(
    rumor.content,
  );
});
it('live and backfill delivery of a followed wrap hand off exactly once', async () => {
  const owner = 'c'.repeat(64);
  mockSession = { pubkey: owner, acceptWelcome: mockAccept, previewWelcome: mockPreview };
  await Promise.all([
    routeMarmotWelcome(rumor, owner, 'same-wrap', true, true),
    routeMarmotWelcome(rumor, owner, 'same-wrap', true, false),
  ]);
  await settle();
  expect(mockAccept).toHaveBeenCalledTimes(1);
  expect(fireMessageNotification).not.toHaveBeenCalled();
});
it('does not join or notify own, malformed, or cancelled Welcomes', async () => {
  const owner = 'd'.repeat(64);
  expect(await routeMarmotWelcome({ ...rumor, pubkey: owner }, owner, 'own', true, true)).toBe(
    true,
  );
  expect(await routeMarmotWelcome({ ...rumor, pubkey: 'bad' }, owner, 'bad', true, true)).toBe(
    true,
  );
  expect(await routeMarmotWelcome(rumor, owner, 'cancelled', true, true, () => true)).toBe(true);
  expect(mockBackends.has(owner)).toBe(false);
  expect(mockAccept).not.toHaveBeenCalled();
  expect(fireMessageNotification).not.toHaveBeenCalled();
});
