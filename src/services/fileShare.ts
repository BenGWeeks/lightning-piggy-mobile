import * as Sharing from 'expo-sharing';
import type { FileAttachment } from '../utils/fileAttachment';
import {
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
  const uri = await resolveDecryptedMedia({ ...file, kind: 'file' });
  const release = retainDecryptedFile(uri);
  try {
    const metadata = verifiedFileMetadata(uri);
    if (metadata) onVerified(metadata);
    await Sharing.shareAsync(uri, {
      mimeType: file.dangerous
        ? 'application/octet-stream'
        : (metadata?.mime ?? 'application/octet-stream'),
      dialogTitle: file.name,
    });
  } finally {
    release();
  }
}
