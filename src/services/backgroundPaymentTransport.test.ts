import { readBackgroundPayments } from './backgroundPaymentTransport';
const mockEnable = jest.fn();
const mockList = jest.fn();
const mockClose = jest.fn();
jest.mock('@getalby/sdk', () => ({
  NostrWebLNProvider: jest
    .fn()
    .mockImplementation(() => ({
      enable: mockEnable,
      close: mockClose,
      client: { listTransactions: mockList },
    })),
}));
jest.mock('./nwcEncryption', () => ({
  pinNip04IfNoInfoEvent: jest.fn(),
  clearEncryptionDecision: jest.fn(),
}));
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockEnable.mockResolvedValue(undefined);
  mockList.mockResolvedValue({ transactions: [] });
});
afterEach(() => jest.useRealTimers());
it('only requests paid incoming history on its own connection and closes it', async () => {
  await readBackgroundPayments('url', new AbortController().signal);
  expect(mockList).toHaveBeenCalledWith({ type: 'incoming', unpaid: false, limit: 100 });
  expect(mockClose).toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
it('bounds a stalled wallet and cleans up', async () => {
  mockList.mockReturnValue(new Promise(() => {}));
  const request = readBackgroundPayments('url', new AbortController().signal);
  const assertion = expect(request).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(25_000);
  await assertion;
  expect(mockClose).toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
it('cancels on stop and does not issue history requests after a late enable', async () => {
  let enabled!: () => void;
  mockEnable.mockReturnValue(
    new Promise<void>((resolve) => {
      enabled = resolve;
    }),
  );
  const controller = new AbortController();
  const request = readBackgroundPayments('url', controller.signal);
  const assertion = expect(request).rejects.toThrow('cancelled');
  controller.abort();
  await assertion;
  enabled();
  await jest.advanceTimersByTimeAsync(0);
  expect(mockList).not.toHaveBeenCalled();
  expect(mockClose.mock.calls.length).toBeGreaterThanOrEqual(2);
});
