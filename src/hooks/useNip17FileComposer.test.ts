import { act, renderHook } from '@testing-library/react-native';
import { Buffer } from 'buffer';
import { useNip17FileComposer } from './useNip17FileComposer';
import { MAX_FILE_BYTES } from '../services/fileDownload';

const mockPicker = jest.fn();
const mockUpload = jest.fn();
const mockAlert = jest.fn();
const mockSigner = jest.fn();
jest.mock('expo-file-system', () => ({
  File: { pickFileAsync: (...args: unknown[]) => mockPicker(...args) },
  Paths: { cache: { uri: 'file:///cache/' } },
}));
jest.mock('../services/imageUploadService', () => ({
  uploadEncryptedBlob: (...args: unknown[]) => mockUpload(...args),
}));
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ isLoggedIn: true, signEvent: mockSigner }),
}));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../components/BrandedAlert', () => ({
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
}));

beforeEach(() => jest.clearAllMocks());
const picked = () => ({
  uri: 'content://documents/1',
  name: '../invoice\u202e.pdf',
  type: 'application/pdf',
  size: 8,
  base64: jest.fn(async () => Buffer.from('%PDF-1.4').toString('base64')),
  delete: jest.fn(),
});

it('reads only the selected file and sends its encrypted upload as NIP-17 with a sanitized filename', async () => {
  const file = picked();
  mockPicker.mockResolvedValue(file);
  mockUpload.mockResolvedValue({ url: 'https://example.com/cipher', mime: 'application/pdf' });
  const send = jest.fn(async () => true);
  const { result } = renderHook(() => useNip17FileComposer('nip17', send, jest.fn()));
  await act(async () => {
    await result.current.pickFile?.();
  });
  expect(mockUpload).toHaveBeenCalledWith(
    file.uri,
    mockSigner,
    'application/pdf',
    await file.base64(),
  );
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ filename: 'invoice.pdf' }),
    'file',
    'nip17',
  );
  expect(file.delete).not.toHaveBeenCalled();
  expect(result.current.uploading).toBe(false);
});
it.each(['marmot', 'nip04'] as const)('does not expose a NIP-17 file picker in %s', (protocol) => {
  const { result } = renderHook(() => useNip17FileComposer(protocol, jest.fn(), jest.fn()));
  expect(result.current.pickFile).toBeUndefined();
});
it('rejects oversized provider metadata before reading or uploading', async () => {
  const file = { ...picked(), size: MAX_FILE_BYTES };
  mockPicker.mockResolvedValue(file);
  const { result } = renderHook(() => useNip17FileComposer('nip17', jest.fn(), jest.fn()));
  await act(async () => {
    await result.current.pickFile?.();
  });
  expect(file.base64).not.toHaveBeenCalled();
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockAlert).toHaveBeenCalled();
});
it('treats picker cancellation as no send and no error', async () => {
  mockPicker.mockRejectedValue(new Error('File picking was cancelled by the user'));
  const send = jest.fn();
  const { result } = renderHook(() => useNip17FileComposer('nip17', send, jest.fn()));
  await act(async () => {
    await result.current.pickFile?.();
  });
  expect(send).not.toHaveBeenCalled();
  expect(mockAlert).not.toHaveBeenCalled();
});

it('does not open the picker when the group send target is unavailable', async () => {
  const { result } = renderHook(() =>
    useNip17FileComposer('nip17', jest.fn(), jest.fn(), () => false),
  );
  await act(async () => {
    await result.current.pickFile?.();
  });
  expect(mockPicker).not.toHaveBeenCalled();
});
