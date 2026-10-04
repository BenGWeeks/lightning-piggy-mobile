const mockGetHeight = jest.fn();
const mockCreate = jest.fn(async () => ({ getHeight: mockGetHeight }));
const mockServer = jest.fn(async () => 'electrum.example:50002:s');
jest.mock('bdk-rn', () => ({ Blockchain: jest.fn(() => ({ create: mockCreate })) }));
jest.mock('bdk-rn/lib/lib/enums', () => ({}));
jest.mock('./walletStorageService', () => ({ getElectrumServer: () => mockServer() }));
import { disconnectElectrum, getBlockHeight } from './onchainService';

beforeEach(() => {
  disconnectElectrum();
  jest.clearAllMocks();
  mockCreate.mockImplementation(async () => ({ getHeight: mockGetHeight }));
});

it('discards a failed Electrum socket so the next swap can fetch a fresh tip', async () => {
  mockGetHeight.mockRejectedValueOnce(new Error('socket closed')).mockResolvedValue(900000);
  await expect(getBlockHeight()).rejects.toThrow('socket closed');
  await expect(getBlockHeight()).resolves.toBe(900000);
  expect(mockCreate).toHaveBeenCalledTimes(2);
  await expect(getBlockHeight()).resolves.toBe(900000);
  expect(mockCreate).toHaveBeenCalledTimes(2);
});

it('cannot cache an old native connection that finishes after an endpoint change', async () => {
  let resolveOld!: (value: { getHeight: jest.Mock }) => void;
  const oldHeight = jest.fn(async () => 899999);
  const newHeight = jest.fn(async () => 900001);
  mockCreate
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockImplementationOnce(async () => ({ getHeight: newHeight }));
  const old = getBlockHeight();
  const rejected = expect(old).rejects.toThrow('Electrum settings changed');
  await Promise.resolve();
  disconnectElectrum();
  mockServer.mockResolvedValue('new.example:50002:s');
  await expect(getBlockHeight()).resolves.toBe(900001);
  resolveOld({ getHeight: oldHeight });
  await rejected;
  await expect(getBlockHeight()).resolves.toBe(900001);
  expect(oldHeight).not.toHaveBeenCalled();
  expect(mockCreate).toHaveBeenCalledTimes(2);
  expect(mockCreate).toHaveBeenLastCalledWith(
    expect.objectContaining({ url: 'ssl://new.example:50002', validateDomain: true }),
  );
});
