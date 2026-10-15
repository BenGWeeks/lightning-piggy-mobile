import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, TouchableOpacity, View } from 'react-native';
import { FileText, ShieldOff } from 'lucide-react-native';
import { Alert } from './BrandedAlert';
import { FileVerificationError } from '../services/fileDownload';
import { useLocale } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMessageFileBubbleStyles } from '../styles/MessageFileBubble.styles';
import type { FileAttachment } from '../utils/fileAttachment';
import { Image } from 'expo-image';
import { useTapToReveal } from '../hooks/useTapToReveal';
import { usePdfPreview } from '../hooks/usePdfPreview';
import { attachmentTypeLabel, formatAttachmentSize } from '../utils/attachmentPresentation';
import { isSafeFileUrl } from '../utils/fileAttachment';

type FileShareModule = typeof import('../services/fileShare');

export default React.memo(function MessageFileBubble({
  id,
  file,
  fromMe,
  autoLoad = false,
  header,
  onLongPress,
  footer,
}: {
  id: string;
  file: FileAttachment;
  fromMe: boolean;
  autoLoad?: boolean;
  header?: React.ReactNode;
  onLongPress?: () => void;
  footer: React.ReactNode;
}) {
  const { t } = useLocale();
  const colors = useThemeColors();
  const styles = useMemo(() => createMessageFileBubbleStyles(colors), [colors]);
  const safe = file.available && isSafeFileUrl(file.url);
  const [allowed, reveal] = useTapToReveal(
    `pdf:${id}:${file.url}`,
    (autoLoad || fromMe) && safe && !file.plainUrl,
  );
  const isPdf = file.mime === 'application/pdf' && !file.dangerous && !file.typeMismatch;
  const preview = usePdfPreview(file, safe && allowed && isPdf);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<'verification' | 'share' | null>(null);
  const [verified, setVerified] = useState<{ size: number; mime: string } | null>(null);
  const share = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      // Load crypto and native sharing only on an explicit user action.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { shareFileAttachment } = require('../services/fileShare') as FileShareModule;
      await shareFileAttachment(
        file,
        () =>
          new Promise<boolean>((resolve) => {
            Alert.alert(
              t('messageBubble.fileWarningTitle'),
              t('messageBubble.fileWarning'),
              [
                { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
                { text: t('messageBubble.fileSave'), onPress: () => resolve(true) },
              ],
              { onDismiss: () => resolve(false) },
            );
          }),
        setVerified,
      );
    } catch (error) {
      setFailed(error instanceof FileVerificationError ? 'verification' : 'share');
    } finally {
      setBusy(false);
    }
  }, [busy, file, t]);
  const type = attachmentTypeLabel(verified?.mime ?? file.mime, file.name);
  const friendlyType = ['Text', 'Audio', 'Video'].includes(type)
    ? t(`messageBubble.fileLabel${type}` as 'messageBubble.fileLabelText')
    : type;
  const size = verified?.size ?? file.size;
  const formattedSize = formatAttachmentSize(size);
  const sizeLabel =
    formattedSize && size !== undefined && size < 1000
      ? t('messageBubble.fileBytes', { size: formattedSize })
      : formattedSize;
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
        {preview && (
          <Image
            source={{ uri: preview }}
            style={styles.preview}
            cachePolicy="memory"
            contentFit="contain"
          />
        )}
        <View style={styles.body}>
          {header}
          {file.plainUrl ? (
            <ShieldOff size={24} color={colors.textSupplementary} />
          ) : !preview ? (
            <FileText size={24} color={colors.textSupplementary} />
          ) : null}
          {file.plainUrl && <Text style={styles.caption}>{t('messageBubble.filePlainUrl')}</Text>}
          <Text style={styles.name} numberOfLines={1} ellipsizeMode="middle">
            {file.name || t('messageBubble.file')}
          </Text>
          <Text style={styles.caption}>
            {[friendlyType, sizeLabel].filter(Boolean).join(' · ')}
          </Text>
          {isPdf && safe && !allowed && (
            <TouchableOpacity
              onPress={reveal}
              accessibilityRole="button"
              accessibilityLabel={t('chatMenu.loadMedia')}
              testID={`chat-file-load-${shortId}`}
            >
              <Text style={styles.actionText}>{t('chatMenu.loadMedia')}</Text>
            </TouchableOpacity>
          )}
          {(file.typeMismatch || (file.plainUrl && verified && verified.mime !== file.mime)) && (
            <Text style={styles.caption}>
              {t('messageBubble.fileTypeMismatch', { type: friendlyType })}
            </Text>
          )}
          {file.caption ? <Text style={styles.name}>{file.caption}</Text> : null}
          {file.available && isSafeFileUrl(file.url) ? (
            <TouchableOpacity
              testID={`chat-file-share-${shortId}`}
              accessibilityLabel={t(
                file.dangerous ? 'messageBubble.fileSave' : 'messageBubble.fileShare',
              )}
              accessibilityRole="button"
              disabled={busy}
              onPress={share}
              style={styles.action}
            >
              <Text style={styles.actionText}>
                {t(
                  busy
                    ? 'messageBubble.filePreparing'
                    : file.dangerous
                      ? 'messageBubble.fileSave'
                      : 'messageBubble.fileShare',
                )}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.caption}>{t('messageBubble.fileUnavailable')}</Text>
          )}
          {failed && (
            <Text style={styles.caption} accessibilityRole="alert">
              {t(
                failed === 'verification'
                  ? 'messageBubble.fileVerificationFailed'
                  : 'messageBubble.fileShareFailed',
              )}
            </Text>
          )}
          {footer}
        </View>
      </Pressable>
    </View>
  );
});
