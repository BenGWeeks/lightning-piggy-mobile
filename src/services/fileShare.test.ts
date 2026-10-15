import { shareFileAttachment } from './fileShare';
import { parseFileAttachment } from '../utils/fileAttachment';
import * as Sharing from 'expo-sharing';
import {
  namedFileExport,
  retainDecryptedFile,
  resolveDecryptedMedia,
  verifiedFileMetadata,
} from './decryptedMediaCache';
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));
jest.mock('../utils/remoteUrlPolicy', () => ({
  ...jest.requireActual('../utils/remoteUrlPolicy'),
  fetchBounded: jest.fn(),
}));
const mockRelease = jest.fn();
jest.mock('./decryptedMediaCache', () => ({
  namedFileExport: jest.fn(
    async (_uri: string, name: string) => `file:///safe.bin.share/${encodeURIComponent(name)}`,
  ),
  resolveDecryptedMedia: jest.fn(async () => 'file:///safe.bin'),
  retainDecryptedFile: jest.fn(() => mockRelease),
  verifiedFileMetadata: jest.fn(() => ({ mime: 'application/pdf', size: 9 })),
}));
const file = (name: string, mime: string) =>
  parseFileAttachment(
    '[FILE]' +
      JSON.stringify({
        name,
        mime,
        url: 'https://example.com/file',
        encrypted: false,
        plaintextSha256: 'aa'.repeat(32),
      }),
  )!;
beforeEach(() => jest.clearAllMocks());
it('requires warning approval before downloading dangerous files and shares generic bytes', async () => {
  const confirm = jest.fn(async () => true);
  await shareFileAttachment(file('invoice.pdf.apk', 'application/pdf'), confirm, jest.fn());
  expect(confirm).toHaveBeenCalled();
  expect(namedFileExport).toHaveBeenCalledWith('file:///safe.bin', 'attachment.bin');
  expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(
    (resolveDecryptedMedia as jest.Mock).mock.invocationCallOrder[0],
  );
  expect(Sharing.shareAsync).toHaveBeenCalledWith(
    'file:///safe.bin.share/attachment.bin',
    expect.objectContaining({ mimeType: 'application/octet-stream' }),
  );
  expect(retainDecryptedFile).toHaveBeenCalledWith('file:///safe.bin');
  expect(mockRelease).toHaveBeenCalled();
});
it('canceling the warning fetches and shares nothing', async () => {
  await shareFileAttachment(file('x.txt', 'text/html'), async () => false, jest.fn());
  expect(resolveDecryptedMedia).not.toHaveBeenCalled();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
it('uses verified MIME and actual size, not sender metadata', async () => {
  const verified = jest.fn();
  await shareFileAttachment(file('invoice.pdf', 'application/attacker'), jest.fn(), verified);
  expect(verified).toHaveBeenCalledWith({ mime: 'application/pdf', size: 9 });
  expect(Sharing.shareAsync).toHaveBeenCalledWith(
    'file:///safe.bin.share/invoice.pdf',
    expect.objectContaining({ mimeType: 'application/pdf' }),
  );
});
it('schedules cleanup even when the chooser fails', async () => {
  (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error('chooser'));
  await expect(
    shareFileAttachment(file('x.pdf', 'application/pdf'), jest.fn(), jest.fn()),
  ).rejects.toThrow('chooser');
  expect(retainDecryptedFile).toHaveBeenCalledWith('file:///safe.bin');
  expect(mockRelease).toHaveBeenCalled();
});
it('falls back to generic bytes when no verified type exists', async () => {
  (verifiedFileMetadata as jest.Mock).mockReturnValueOnce(undefined);
  await shareFileAttachment(file('x.pdf', 'application/pdf'), jest.fn(), jest.fn());
  expect(Sharing.shareAsync).toHaveBeenCalledWith(
    'file:///safe.bin.share/x.pdf',
    expect.objectContaining({ mimeType: 'application/octet-stream' }),
  );
});

it('holds the file lease while the chooser is open', async () => {
  let settle!: () => void;
  (Sharing.shareAsync as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  const share = shareFileAttachment(file('a.pdf', 'application/pdf'), jest.fn(), jest.fn());
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(retainDecryptedFile).toHaveBeenCalledWith('file:///safe.bin');
  expect(mockRelease).not.toHaveBeenCalled();
  settle();
  await share;
  expect(mockRelease).toHaveBeenCalledTimes(1);
});
it('rejects unavailable hashless files before downloading or opening the chooser', async () => {
  await expect(
    shareFileAttachment(
      { ...file('a.pdf', 'application/pdf'), available: false, plaintextSha256: undefined },
      jest.fn(),
      jest.fn(),
    ),
  ).rejects.toThrow('File unavailable');
  expect(resolveDecryptedMedia).not.toHaveBeenCalled();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

it.each(['invoice.pdf', 'report.csv', 'budget.xlsx'])(
  'passes the sanitized recipient filename %s in the URI',
  async (name) => {
    await shareFileAttachment(file(`../${name}`, 'application/octet-stream'), jest.fn(), jest.fn());
    expect(namedFileExport).toHaveBeenCalledWith('file:///safe.bin', name);
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      `file:///safe.bin.share/${name}`,
      expect.any(Object),
    );
  },
);

it('keeps optional HEAD behind a tap and bounds the plain-URL GET using its advertised size', async () => {
  const { parsePlainFileAttachment } = jest.requireActual('../utils/fileAttachment');
  const file = parsePlainFileAttachment('https://example.com/invoice.pdf')!;
  const { fetchBounded } = jest.requireMock('../utils/remoteUrlPolicy');
  fetchBounded.mockResolvedValueOnce({ headers: { get: () => '42' } });
  await shareFileAttachment(file, jest.fn(), jest.fn());
  expect(fetchBounded).toHaveBeenCalledWith(
    file.url,
    expect.objectContaining({ method: 'HEAD', maxBytes: 50 * 1024 * 1024 }),
  );
  expect(resolveDecryptedMedia).toHaveBeenCalledWith(
    expect.objectContaining({ size: 42, plainUrl: true, kind: 'file' }),
  );
  expect(Sharing.shareAsync).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ mimeType: 'application/pdf' }),
  );
});

it('falls back to the capped GET when the server rejects HEAD', async () => {
  const { parsePlainFileAttachment } = jest.requireActual('../utils/fileAttachment');
  const { fetchBounded } = jest.requireMock('../utils/remoteUrlPolicy');
  fetchBounded.mockRejectedValueOnce(new Error('HEAD unsupported'));
  await shareFileAttachment(
    parsePlainFileAttachment('https://example.com/invoice.pdf')!,
    jest.fn(),
    jest.fn(),
  );
  expect(resolveDecryptedMedia).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'file', size: undefined }),
  );
});
