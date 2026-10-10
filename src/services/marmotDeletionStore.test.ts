jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeletionLedger } from './marmotDeletions';
import { rememberMarmotDeletions, isMarmotDeleted } from './marmotDeletionStore';
import {
  appendGroupMessage,
  loadGroupMessages,
  removeGroupMessagesWhere,
} from './groupMessagesStorageService';

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('retains author and admin tombstones across cache eviction and a fresh ledger', async () => {
  const deletion = { targets: ['target'], deleter: 'alice', anyAuthor: false };
  await rememberMarmotDeletions('g', [deletion, { ...deletion, deleter: 'bob' }]);
  const ledger = new DeletionLedger();
  ledger.add(deletion, 'g');
  for (let i = 0; i < 2001; i++) ledger.add({ ...deletion, targets: [String(i)] }, 'g');
  expect(ledger.blocks('target', 'alice', 'g')).toBe(false);
  expect(await isMarmotDeleted('g', 'target', 'alice')).toBe(true);
  expect(await isMarmotDeleted('g2', 'target', 'alice')).toBe(false);
  expect(await isMarmotDeleted('g', 'target', 'carol')).toBe(false);
  await rememberMarmotDeletions('g', [{ ...deletion, anyAuthor: true }, deletion]);
  expect(await isMarmotDeleted('g', 'target', 'carol')).toBe(true);
  await appendGroupMessage('g', {
    id: 'target',
    senderPubkey: 'alice',
    text: 'secret',
    createdAt: 1,
  });
  expect(await loadGroupMessages('g')).toEqual([]);
});

it('retries safely and fails closed on tombstone read failures', async () => {
  await appendGroupMessage('g', {
    id: 'target',
    senderPubkey: 'alice',
    text: 'secret',
    createdAt: 1,
  });
  await rememberMarmotDeletions('g', [{ targets: ['target'], deleter: 'alice', anyAuthor: false }]);
  await removeGroupMessagesWhere('g', (m) => m.id === 'target');
  (AsyncStorage.multiGet as jest.Mock).mockRejectedValueOnce(new Error('read failed'));
  await expect(
    appendGroupMessage('g', { id: 'target', senderPubkey: 'alice', text: 'secret', createdAt: 1 }),
  ).rejects.toThrow('read failed');
  expect(await loadGroupMessages('g')).toEqual([]);
});
