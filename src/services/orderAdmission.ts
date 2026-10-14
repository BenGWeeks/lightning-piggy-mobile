import AsyncStorage from '@react-native-async-storage/async-storage';
import { admitOrder, type OrderBudget } from '../utils/orderRateLimit';
import { parseOrderEvent } from '../utils/orderEvents';
import { rumorEventId, type DecodedRumor } from '../utils/nip17Unwrap';
import { isSellerAccountForgotten } from './sellerEventStore';

export const orderBudgetKey = (owner: string) => `market-order-budget:${owner.toLowerCase()}`;
let chain: Promise<unknown> = Promise.resolve();

/** Shared by batch, live and deferred NIP-17 ingest, independent of the Messages follow gate.
 * Serialize persistent reservations so simultaneous deliveries cannot exceed the budget.
 * A storage failure fails closed. No relay-controlled clock or public event is admitted. */
export function acceptOrderRumor(
  owner: string,
  rumor: DecodedRumor,
  fromMe: boolean,
): Promise<boolean> {
  if (rumor.kind !== 16 && rumor.kind !== 17) return Promise.resolve(true);
  if (!parseOrderEvent(rumor)) return Promise.resolve(false);
  if (fromMe) return Promise.resolve(true);
  const run = chain
    .then(async () => {
      if (isSellerAccountForgotten(owner)) return false;
      const raw = await AsyncStorage.getItem(orderBudgetKey(owner));
      const now = Date.now();
      const budget: OrderBudget = raw
        ? JSON.parse(raw)
        : { accepted: [], dropped: 0, droppedSince: now };
      const result = admitOrder(budget, rumor.pubkey, rumorEventId(rumor), now);
      if (isSellerAccountForgotten(owner)) return false;
      await AsyncStorage.setItem(orderBudgetKey(owner), JSON.stringify(result.budget));
      return !isSellerAccountForgotten(owner) && result.allowed;
    })
    .catch(() => false);
  chain = run;
  return run;
}
/** Await in-flight reservations before account cleanup removes the persisted counters. */
export async function drainOrderAdmission(): Promise<void> {
  await chain;
}
