import AsyncStorage from '@react-native-async-storage/async-storage';
import { hydrateWalletReceipts } from './hydrateWalletReceipts';

const readStorage = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
afterEach(() => jest.mocked(AsyncStorage.getItem).mockImplementation(readStorage));

it.each([false, true])(
  'does not seed receipts after cancellation (read failure: %p)',
  async (fail) => {
    let resolve!: (value: string | null) => void;
    let reject!: (reason: Error) => void;
    const read = new Promise<string | null>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => read);
    let current = true;
    const seed = jest.fn();
    const pending = hydrateWalletReceipts('wallet', [], seed, () => current);
    current = false;
    if (fail) reject(new Error('disk unavailable'));
    else resolve('["old-receipt"]');
    await pending;
    expect(seed).not.toHaveBeenCalled();
  },
);
it('hydrates persisted receipts without rewriting them when still current', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('["receipt"]');
  const seed = jest.fn();
  await hydrateWalletReceipts('wallet', [], seed, () => true);
  expect(seed).toHaveBeenCalledWith('wallet', new Set(['receipt']), false);
});
