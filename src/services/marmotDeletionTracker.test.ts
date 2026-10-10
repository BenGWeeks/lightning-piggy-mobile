const mockRemember = jest.fn();
const mockDeleted = jest.fn();
jest.mock('./marmotDeletionStore', () => ({
  rememberMarmotDeletions: (...args: unknown[]) => mockRemember(...args),
  deletedMarmotMessages: (...args: unknown[]) => mockDeleted(...args),
  marmotMessageKey: (scope: string, id: string) => `${scope}\n${id}`,
}));
jest.mock('./notificationService', () => ({
  retractMarmotMessageNotifications: jest.fn().mockResolvedValue(0),
}));

import { MarmotDeletionTracker } from './marmotDeletionTracker';

const own = (targets: string[], deleter = 'alice') => ({ targets, deleter, anyAuthor: false });

beforeEach(() => {
  jest.useFakeTimers();
  mockRemember.mockReset().mockResolvedValue(undefined);
  mockDeleted.mockReset().mockResolvedValue(new Set());
});
afterEach(() => jest.useRealTimers());

it('keeps deletions pending (and blocking) when the durable write fails, then retries them', async () => {
  const tracker = new MarmotDeletionTracker('owner', 0);
  tracker.note('g', own(['t1']), 1);
  mockRemember.mockRejectedValueOnce(new Error('db locked'));
  await expect(tracker.persist()).rejects.toThrow('db locked');
  expect(tracker.blocks('g', 't1', 'alice')).toBe(true);
  tracker.note('g', own(['t2']), 1);
  await tracker.persist();
  expect(mockRemember).toHaveBeenLastCalledWith('owner', [
    { scope: 'g', deletion: own(['t1']) },
    { scope: 'g', deletion: own(['t2']) },
  ]);
  tracker.dispose();
});

it('blocks while the write is in flight, even past the session cache cap', async () => {
  const tracker = new MarmotDeletionTracker('owner', 0);
  tracker.note('g', own(['target']), 1);
  let finish!: () => void;
  mockRemember.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
  const writing = tracker.persist();
  for (let i = 0; i < 2100; i++) tracker.note('g', own([`x${i}`], 'mallory'), 1);
  expect(tracker.blocks('g', 'target', 'alice')).toBe(true);
  expect(tracker.blocks('g', 'target', 'mallory')).toBe(false);
  finish();
  await writing;
  tracker.dispose();
});

it('filters a batch with the session view first, then one durable lookup', async () => {
  const tracker = new MarmotDeletionTracker('owner', 0);
  tracker.note('g', own(['seen']), 1);
  mockDeleted.mockResolvedValueOnce(new Set(['g\nstored']));
  const items = ['seen', 'stored', 'fresh'].map((id) => ({ scope: 'g', id, sender: 'alice' }));
  expect(await tracker.filterLive(items, (i) => i)).toEqual([items[2]]);
  expect(mockDeleted).toHaveBeenCalledTimes(1);
  expect(mockDeleted.mock.calls[0][1]).toEqual([items[1], items[2]]);
  tracker.dispose();
});
