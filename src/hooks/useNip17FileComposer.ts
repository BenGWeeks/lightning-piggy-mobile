import { useCallback, useState } from 'react';
import { Buffer } from 'buffer';
import { Alert } from '../components/BrandedAlert';
import { useTranslation } from '../contexts/LocaleContext';
import { useNostr } from '../contexts/NostrContext';
import type { DmProtocol } from '../utils/dmProtocol';
import { sanitizeAttachmentText } from '../utils/fileAttachment';
import { selectedDocumentName } from '../services/documentMetadata';
import type { EncryptedUpload } from '../services/imageUploadService';

export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

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
        // Bound JS encryption/base64 memory before reading, then check actual
        // bytes as well: provider metadata is not authoritative.
        if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) throw new RangeError('File size');
        const base64 = await file.base64();
        const size = Buffer.byteLength(base64, 'base64');
        if (size <= 0 || size > MAX_UPLOAD_BYTES) throw new RangeError('File size');
        const filename = sanitizeAttachmentText(await selectedDocumentName(file));
        const started = performance.now();
        const uploaded = await upload.uploadEncryptedBlob(
          file.uri,
          signEvent,
          file.type || 'application/octet-stream',
          base64,
        );
        if (__DEV__ || process.env.EXPO_PUBLIC_KEEP_PERF_LOGS === '1') {
          console.log(
            `[PerfBlock] file encrypt+upload bytes=${size} ms=${(performance.now() - started).toFixed(1)}`,
          );
        }
        await send({ ...uploaded, filename }, 'file', 'nip17');
      } finally {
        // iOS returns a temporary copy. Never delete the user's original.
        if (file.uri.startsWith(Paths.cache.uri)) file.delete();
      }
    } catch (error) {
      if (error instanceof Error && /cancelled|canceled/i.test(error.message)) return;
      Alert.alert(
        t('messageBubble.file'),
        t(
          error instanceof RangeError
            ? 'messageBubble.fileUploadLimit'
            : 'messageBubble.fileShareFailed',
        ),
      );
    } finally {
      setUploading(false);
    }
  }, [uploading, isLoggedIn, protocol, canSend, setPanelOpen, signEvent, send, t]);
  return { uploading, pickFile: protocol === 'nip17' ? pickFile : undefined };
}
