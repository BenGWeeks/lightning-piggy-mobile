import { shareFileAttachment } from './fileShare';
import { parseFileAttachment } from '../utils/fileAttachment';
import * as Sharing from 'expo-sharing';
import {
  deleteDecryptedFile,
  resolveDecryptedMedia,
  verifiedFileMetadata,
} from './decryptedMediaCache';
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));
jest.mock('./decryptedMediaCache', () => ({
  resolveDecryptedMedia: jest.fn(async () => 'file:///safe.bin'),
  deleteDecryptedFile: jest.fn(async () => {}),
  verifiedFileMetadata: jest.fn(() => ({ mime: 'application/pdf', size: 9 })),
}));
const file = (name: string, mime: string) =>
  parseFileAttachment(
    '[FILE]' + JSON.stringify({ name, mime, url: 'https://example.com/file', encrypted: false }),
  )!;
beforeEach(() => jest.clearAllMocks());
it('requires warning approval before downloading dangerous files and shares generic bytes', async () => {
  const confirm = jest.fn(async () => true);
  await shareFileAttachment(file('invoice.pdf.apk', 'application/pdf'), confirm, jest.fn());
  expect(confirm).toHaveBeenCalled();
  expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(
    (resolveDecryptedMedia as jest.Mock).mock.invocationCallOrder[0],
  );
  expect(Sharing.shareAsync).toHaveBeenCalledWith(
    'file:///safe.bin',
    expect.objectContaining({ mimeType: 'application/octet-stream' }),
  );
  expect(deleteDecryptedFile).toHaveBeenCalledWith('file:///safe.bin');
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
    'file:///safe.bin',
    expect.objectContaining({ mimeType: 'application/pdf' }),
  );
});
it('deletes plaintext even when the chooser fails', async () => {
  (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error('chooser'));
  await expect(
    shareFileAttachment(file('x.pdf', 'application/pdf'), jest.fn(), jest.fn()),
  ).rejects.toThrow('chooser');
  expect(deleteDecryptedFile).toHaveBeenCalledWith('file:///safe.bin');
});
it('falls back to generic bytes when no verified type exists', async () => {
  (verifiedFileMetadata as jest.Mock).mockReturnValueOnce(undefined);
  await shareFileAttachment(file('x.pdf', 'application/pdf'), jest.fn(), jest.fn());
  expect(Sharing.shareAsync).toHaveBeenCalledWith(
    'file:///safe.bin',
    expect.objectContaining({ mimeType: 'application/octet-stream' }),
  );
});
