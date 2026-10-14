import * as SecureStore from 'expo-secure-store';
import type { DeliveryAddress } from '../utils/deliveryAddress';

export const checkoutAddressKey = (account: string) => `market_checkout_address_v1_${account}`;
let queue: Promise<void> = Promise.resolve();
const generations = new Map<string, number>();
export const checkoutAddressGeneration = (account: string) => generations.get(account) ?? 0;
export async function readCheckoutAddress(account: string): Promise<DeliveryAddress | null> {
  const epoch = checkoutAddressGeneration(account);
  try {
    await queue.catch(() => {});
    const raw = await SecureStore.getItemAsync(checkoutAddressKey(account));
    if (!raw || raw.length > 4000 || checkoutAddressGeneration(account) !== epoch) return null;
    const value = JSON.parse(raw);
    if (
      !value ||
      !['name', 'line1', 'line2', 'town', 'postcode'].every(
        (key) => typeof value[key] === 'string' && value[key].length <= 500,
      )
    )
      return null;
    return {
      name: value.name,
      line1: value.line1,
      line2: value.line2,
      town: value.town,
      postcode: value.postcode,
    };
  } catch {
    return null;
  }
}
/** Opt-in only; address fields never enter AsyncStorage. */
export function rememberCheckoutAddress(
  account: string,
  fields: DeliveryAddress,
  remember: boolean,
  epoch = checkoutAddressGeneration(account),
): Promise<void> {
  if (!remember) return Promise.resolve();
  queue = queue
    .catch(() => {})
    .then(async () => {
      if (checkoutAddressGeneration(account) === epoch) {
        await SecureStore.setItemAsync(checkoutAddressKey(account), JSON.stringify(fields));
      }
    });
  return queue;
}
export function wipeCheckoutAddress(account: string): Promise<void> {
  generations.set(account, checkoutAddressGeneration(account) + 1);
  queue = queue
    .catch(() => {})
    .then(() => SecureStore.deleteItemAsync(checkoutAddressKey(account)));
  return queue;
}
