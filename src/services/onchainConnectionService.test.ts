const mockSave = jest.fn();
const mockHeight = jest.fn();
const mockDisconnect = jest.fn();
jest.mock('./walletStorageService', () => ({
  DEFAULT_ELECTRUM_SERVER: 'electrum.example:50002:s',
  setElectrumServer: (...args: unknown[]) => mockSave(...args),
}));
jest.mock('./onchainService', () => ({
  getBlockHeight: () => mockHeight(),
  disconnectElectrum: () => mockDisconnect(),
}));
import { checkElectrumConnection, saveElectrumSetting } from './onchainConnectionService';

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
  mockHeight.mockResolvedValue(900000);
});
it('never probes when the draft is invalid or could not be persisted', async () => {
  await expect(
    checkElectrumConnection('example:65536', true, new AbortController().signal),
  ).rejects.toThrow('hostname');
  mockSave.mockRejectedValueOnce(new Error('disk full'));
  await expect(
    checkElectrumConnection('example:50002', true, new AbortController().signal),
  ).rejects.toThrow('disk full');
  expect(mockHeight).not.toHaveBeenCalled();
});
it('serializes old blur saves ahead of the Test draft and checks the persisted draft', async () => {
  let finish!: () => void;
  mockSave.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const old = saveElectrumSetting('old.example:50002', true);
  const check = checkElectrumConnection('new.example:50001', false, new AbortController().signal);
  await Promise.resolve();
  await Promise.resolve();
  expect(mockSave).toHaveBeenCalledTimes(1);
  expect(mockHeight).not.toHaveBeenCalled();
  finish();
  await old;
  await expect(check).resolves.toBe(900000);
  expect(mockSave.mock.calls).toEqual([['old.example:50002:s'], ['new.example:50001:t']]);
  expect(mockDisconnect).toHaveBeenCalledTimes(2);
});
it('does not turn cancellation or an invalid chain tip into success', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(checkElectrumConnection('example:50002', true, controller.signal)).rejects.toThrow(
    'cancelled',
  );
  expect(mockSave).not.toHaveBeenCalled();
  mockHeight.mockResolvedValue(null);
  await expect(
    checkElectrumConnection('example:50002', true, new AbortController().signal),
  ).rejects.toThrow('chain tip');
});
