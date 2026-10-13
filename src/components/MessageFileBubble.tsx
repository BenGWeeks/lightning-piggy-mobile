import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, TouchableOpacity, View } from 'react-native';
import { FileText } from 'lucide-react-native';
import * as Sharing from 'expo-sharing';
import { useLocale } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMessageFileBubbleStyles } from '../styles/MessageFileBubble.styles';
import type { FileAttachment } from '../utils/fileAttachment';
import { isPublicHttpUrl } from '../utils/publicUrl';

export default React.memo(function MessageFileBubble({
  id,
  file,
  fromMe,
  header,
  onLongPress,
  footer,
}: {
  id: string;
  file: FileAttachment;
  fromMe: boolean;
  header?: React.ReactNode;
  onLongPress?: () => void;
  footer: React.ReactNode;
}) {
  const { t } = useLocale();
  const colors = useThemeColors();
  const styles = useMemo(() => createMessageFileBubbleStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const share = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing unavailable');
      const { resolveDecryptedMedia } = await import('../services/decryptedMediaCache');
      const uri = await resolveDecryptedMedia({ ...file, kind: 'file' });
      await Sharing.shareAsync(uri, {
        mimeType: file.mime,
        dialogTitle: file.name || t('messageBubble.file'),
      });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [busy, file, t]);
  const shortId = id.replace(/^dm-/, '').slice(0, 8);
  return (
    <View style={[styles.row, fromMe && styles.sent]}>
      <Pressable
        style={styles.bubble}
        onLongPress={onLongPress}
        delayLongPress={350}
        accessible={false}
        testID={`chat-file-bubble-${shortId}`}
        accessibilityLabel={file.name || t('messageBubble.file')}
      >
        {header}
        <FileText size={24} color={colors.textSupplementary} />
        <Text style={styles.name}>{file.name || t('messageBubble.file')}</Text>
        <Text style={styles.caption}>{file.mime}</Text>
        {file.caption ? <Text style={styles.name}>{file.caption}</Text> : null}
        {file.size !== undefined && (
          <Text style={styles.caption}>{t('messageBubble.fileBytes', { size: file.size })}</Text>
        )}
        {file.available && isPublicHttpUrl(file.url) ? (
          <TouchableOpacity
            testID={`chat-file-share-${shortId}`}
            accessibilityLabel={t('messageBubble.fileShare')}
            accessibilityRole="button"
            disabled={busy}
            onPress={share}
            style={styles.action}
          >
            <Text style={styles.actionText}>
              {t(busy ? 'messageBubble.filePreparing' : 'messageBubble.fileShare')}
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.caption}>{t('messageBubble.fileUnavailable')}</Text>
        )}
        {failed && (
          <Text style={styles.caption} accessibilityRole="alert">
            {t('messageBubble.fileShareFailed')}
          </Text>
        )}
        {footer}
      </Pressable>
    </View>
  );
});
