const mockGetHeight = jest.fn();
const mockCreate = jest.fn(async () => ({ getHeight: mockGetHeight }));
jest.mock('bdk-rn', () => ({ Blockchain: jest.fn(() => ({ create: mockCreate })) }));
jest.mock('bdk-rn/lib/lib/enums', () => ({}));
jest.mock('./walletStorageService', () => ({
  getElectrumServer: async () => 'electrum.example:50002:s',
}));
import { getBlockHeight } from './onchainService';

it('discards a failed Electrum socket so the next swap can fetch a fresh tip', async () => {
  mockGetHeight.mockRejectedValueOnce(new Error('socket closed')).mockResolvedValue(900000);
  await expect(getBlockHeight()).rejects.toThrow('socket closed');
  await expect(getBlockHeight()).resolves.toBe(900000);
  expect(mockCreate).toHaveBeenCalledTimes(2);
  await expect(getBlockHeight()).resolves.toBe(900000);
  expect(mockCreate).toHaveBeenCalledTimes(2);
});
