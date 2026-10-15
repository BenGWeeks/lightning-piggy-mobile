import { fetchBounded } from '../utils/remoteUrlPolicy';
import { MAX_FILE_BYTES } from './fileDownload';
import * as Sharing from 'expo-sharing';
import type { FileAttachment } from '../utils/fileAttachment';
import {
  namedFileExport,
  retainDecryptedFile,
  resolveDecryptedMedia,
  verifiedFileMetadata,
} from './decryptedMediaCache';

/** Confirmation precedes fetching; the chooser never receives sender-declared MIME. */
export async function shareFileAttachment(
  file: FileAttachment,
  confirmSave: () => Promise<boolean>,
  onVerified: (metadata: { size: number; mime: string }) => void,
): Promise<void> {
  if (!file.available) throw new Error('File unavailable');
  if (file.dangerous && !(await confirmSave())) return;
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing unavailable');
  if (file.plainUrl) {
    // HEAD is optional and user initiated too; GET independently enforces the
    // cap when a server omits metadata, rejects HEAD, or changes the payload.
    try {
      await fetchBounded(file.url, {
        method: 'HEAD',
        maxBytes: MAX_FILE_BYTES,
        timeoutMs: 5000,
        redirects: 'https-only',
        maxRedirects: 3,
      });
    } catch {
      /* Download remains bounded when HEAD is unavailable. */
    }
  }
  const uri = await resolveDecryptedMedia({
    ...file,
    size: file.plainUrl ? undefined : file.size,
    kind: 'file',
  });
  const release = retainDecryptedFile(uri);
  try {
    const metadata = verifiedFileMetadata(uri);
    if (metadata) onVerified(metadata);
    const exportUri = await namedFileExport(uri, file.dangerous ? 'attachment.bin' : file.name);
    await Sharing.shareAsync(exportUri, {
      mimeType: file.dangerous
        ? 'application/octet-stream'
        : (metadata?.mime ?? 'application/octet-stream'),
      dialogTitle: file.name,
    });
  } finally {
    release();
  }
}
