import { downloadFile, FILE_TIMEOUT_MS, MAX_FILE_BYTES, sniffFileMime } from './fileDownload';
import { fetch } from 'expo/fetch';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
const fetchMock = fetch as jest.Mock;
const cancel = jest.fn(async () => {});
function response(chunks: Uint8Array[], length?: number) {
  let i = 0;
  return {
    ok: true,
    headers: { get: () => length?.toString() ?? null },
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { done: false, value: chunks[i++] } : { done: true },
        cancel,
      }),
    },
  };
}
beforeEach(() => {
  fetchMock.mockReset();
  cancel.mockClear();
});
it.each([
  'http://example.com/f',
  'https://127.0.0.1/f',
  'https://10.0.0.1/f',
  'https://localhost/f',
  'https://hidden.onion/f',
  'https://[::1]/f',
])('rejects %s before fetching', async (url) => {
  await expect(downloadFile(url)).rejects.toThrow('Unsafe');
  expect(fetchMock).not.toHaveBeenCalled();
});
it('rejects the declared size before fetching', async () => {
  await expect(downloadFile('https://example.com/f', MAX_FILE_BYTES + 1)).rejects.toThrow('50 MB');
  expect(fetchMock).not.toHaveBeenCalled();
});
it('rejects an oversized Content-Length without reading', async () => {
  const res = response([], MAX_FILE_BYTES + 1);
  const read = jest.fn();
  res.body.getReader = read;
  fetchMock.mockResolvedValue(res);
  await expect(downloadFile('https://example.com/f')).rejects.toThrow('50 MB');
  expect(read).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});
it('aborts when streaming crosses the cap even without Content-Length', async () => {
  fetchMock.mockResolvedValue(response([new Uint8Array(MAX_FILE_BYTES), new Uint8Array(1)]));
  await expect(downloadFile('https://example.com/f')).rejects.toThrow('50 MB');
  expect(cancel).toHaveBeenCalled();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});
it('streams bounded bytes with redirect error and cancels the reader', async () => {
  fetchMock.mockResolvedValue(response([new Uint8Array([1]), new Uint8Array([2, 3])]));
  expect(await downloadFile('https://example.com/f')).toEqual(new Uint8Array([1, 2, 3]));
  expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
  expect(cancel).toHaveBeenCalled();
});
it('rejects a redirected response', async () => {
  fetchMock.mockResolvedValue({ ...response([]), redirected: true, url: 'https://localhost/file' });
  await expect(downloadFile('https://example.com/f')).rejects.toThrow('rejected');
});
it('aborts a stalled download after 30 seconds', async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation(
    (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
  );
  const pending = expect(downloadFile('https://example.com/f')).rejects.toThrow('aborted');
  await jest.advanceTimersByTimeAsync(FILE_TIMEOUT_MS);
  await pending;
  jest.useRealTimers();
});
it('uses magic bytes rather than claimed MIME', () => {
  expect(sniffFileMime(new Uint8Array(Buffer.from('%PDF-1.4')))).toBe('application/pdf');
  expect(sniffFileMime(new Uint8Array([1, 2]))).toBe('application/octet-stream');
});

it('keeps the timeout active throughout the body read', async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation(async (_url, { signal }) => ({
    ...response([]),
    body: {
      getReader: () => ({
        read: () =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('body aborted'))),
          ),
        cancel,
      }),
    },
  }));
  const pending = expect(downloadFile('https://example.com/f')).rejects.toThrow('body aborted');
  await jest.advanceTimersByTimeAsync(FILE_TIMEOUT_MS);
  await pending;
  expect(cancel).toHaveBeenCalled();
  jest.useRealTimers();
});
