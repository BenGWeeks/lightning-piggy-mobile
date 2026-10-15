import { useCallback, useState } from 'react';
import { Buffer } from 'buffer';
import { Alert } from '../components/BrandedAlert';
import { useTranslation } from '../contexts/LocaleContext';
import { useNostr } from '../contexts/NostrContext';
import type { DmProtocol } from '../utils/dmProtocol';
import { sanitizeAttachmentText } from '../utils/fileAttachment';
import { MAX_FILE_BYTES } from '../services/fileDownload';
import type { EncryptedUpload } from '../services/imageUploadService';

/** Keep the system picker, local reads and upload off the chat startup path. */
export function useNip17FileComposer(
  protocol: DmProtocol,
  send: (file: EncryptedUpload, kind: 'file', protocol: DmProtocol) => Promise<boolean>,
  setPanelOpen: (open: boolean) => void,
  canSend?: () => boolean,
) {
  const t = useTranslation();
  const { isLoggedIn, signEvent } = useNostr();
  const [uploading, setUploading] = useState(false);
  const pickFile = useCallback(async () => {
    if (uploading || !isLoggedIn || protocol !== 'nip17' || canSend?.() === false) return;
    setPanelOpen(false);
    setUploading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
      const upload: typeof import('../services/imageUploadService') =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/imageUploadService');
      const result = await File.pickFileAsync();
      const file = Array.isArray(result) ? result[0] : result;
      if (!file) return;
      try {
        // Reserve the GCM tag in the encrypted download budget. Check before
        // reading and again afterwards: provider metadata isn't authoritative.
        if (file.size <= 0 || file.size > MAX_FILE_BYTES - 16) throw new Error('File size');
        const base64 = await file.base64();
        const size = Buffer.byteLength(base64, 'base64');
        if (size <= 0 || size > MAX_FILE_BYTES - 16) throw new Error('File size');
        const filename = sanitizeAttachmentText(file.name);
        const uploaded = await upload.uploadEncryptedBlob(
          file.uri,
          signEvent,
          file.type || 'application/octet-stream',
          base64,
        );
        await send({ ...uploaded, filename }, 'file', 'nip17');
      } finally {
        // iOS returns a temporary copy. Never delete the user's original.
        if (file.uri.startsWith(Paths.cache.uri)) file.delete();
      }
    } catch (error) {
      if (error instanceof Error && /cancelled|canceled/i.test(error.message)) return;
      Alert.alert(t('messageBubble.file'), t('messageBubble.fileShareFailed'));
    } finally {
      setUploading(false);
    }
  }, [uploading, isLoggedIn, protocol, canSend, setPanelOpen, signEvent, send, t]);
  return { uploading, pickFile: protocol === 'nip17' ? pickFile : undefined };
}
