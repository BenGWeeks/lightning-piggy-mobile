import AsyncStorage from '@react-native-async-storage/async-storage';
import { acceptOrderRumor, orderBudgetKey } from './orderAdmission';
import { resetSellerStore } from './sellerEventStore';
import type { DecodedRumor } from '../utils/nip17Unwrap';
const OWNER = 'a'.repeat(64);
const rumor = (n: number): DecodedRumor => ({
  kind: 16,
  pubkey: 'b'.repeat(64),
  created_at: n,
  content: '',
  tags: [
    ['p', OWNER],
    ['order', String(n)],
    ['type', '1'],
  ],
});
beforeEach(async () => {
  await AsyncStorage.clear();
  resetSellerStore();
});
it('serializes simultaneous admissions and persists rejection counts', async () => {
  const admitted = await Promise.all(
    Array.from({ length: 20 }, (_, n) => acceptOrderRumor(OWNER, rumor(n), false)),
  );
  expect(admitted.filter(Boolean)).toHaveLength(5);
  const budget = JSON.parse((await AsyncStorage.getItem(orderBudgetKey(OWNER)))!);
  expect(budget.accepted).toHaveLength(5);
  expect(budget.dropped).toBe(15);
  expect(await acceptOrderRumor(OWNER, rumor(50), false)).toBe(false);
});
it('uses receipt time, rejects malformed orders, and never budgets outgoing copies', async () => {
  expect(await acceptOrderRumor(OWNER, { ...rumor(1), tags: [] }, false)).toBe(false);
  for (let n = 0; n < 8; n++) expect(await acceptOrderRumor(OWNER, rumor(n), true)).toBe(true);
  expect(await AsyncStorage.getItem(orderBudgetKey(OWNER))).toBeNull();
});
it('fails closed on corrupted persisted counters and storage failure', async () => {
  await AsyncStorage.setItem(orderBudgetKey(OWNER), '{bad');
  expect(await acceptOrderRumor(OWNER, rumor(1), false)).toBe(false);
  await AsyncStorage.clear();
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
  expect(await acceptOrderRumor(OWNER, rumor(2), false)).toBe(false);
  jest.restoreAllMocks();
});
