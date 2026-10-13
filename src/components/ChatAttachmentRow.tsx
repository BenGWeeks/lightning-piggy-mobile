import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { FileText, Link, Mic, ImageIcon } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createChatToolsStyles } from '../styles/ChatTools.styles';
import type { ChatAttachment } from '../utils/chatAttachments';
import {
  peekDecryptedMedia,
  resolveDecryptedMedia,
  type EncryptedMediaRef,
} from '../services/decryptedMediaCache';
import { useTapToReveal } from '../hooks/useTapToReveal';
import { isPublicHttpUrl } from '../utils/publicUrl';
/** Encrypted thumbnails use the same account-scoped cache as chat bubbles. */
function ChatAttachmentRow({
  item,
  autoLoad,
  onOpen,
  onJump,
}: {
  item: ChatAttachment;
  autoLoad: boolean;
  onOpen: (uri: string) => void;
  onJump: (id: string) => void;
}) {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createChatToolsStyles(colors), [colors]);
  const ref = useMemo<EncryptedMediaRef>(
    () => ({ ...item.image, url: item.url, kind: 'image' }),
    [item.image, item.url],
  );
  const [allowed, reveal] = useTapToReveal(
    `chat-media:${item.id}:${item.url}`,
    autoLoad && isPublicHttpUrl(item.url),
  );
  const [uri, setUri] = useState<string | null>(() =>
    item.image?.encrypted ? peekDecryptedMedia(ref) : item.image ? item.url : null,
  );
  useEffect(() => {
    let cancelled = false;
    if (allowed && item.image?.encrypted)
      void resolveDecryptedMedia(ref)
        .then((value) => {
          if (!cancelled) setUri(value);
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [allowed, item.image?.encrypted, ref]);
  const Icon =
    item.kind === 'voice'
      ? Mic
      : item.kind === 'file'
        ? FileText
        : item.kind === 'link'
          ? Link
          : ImageIcon;
  const press = () => {
    if (item.image && !allowed) {
      reveal();
      return;
    }
    if (item.image && uri) onOpen(uri);
    else onJump(item.messageId);
  };
  return (
    <TouchableOpacity
      style={styles.row}
      testID={`chat-attachment-${item.id}`}
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={item.kind === 'image' ? t('chatMenu.openMedia') : item.label}
    >
      {allowed && uri ? (
        <Image
          source={{ uri }}
          style={styles.thumbnail}
          cachePolicy="memory-disk"
          recyclingKey={item.id}
          contentFit="cover"
          autoplay={false}
        />
      ) : (
        <Icon size={36} color={colors.brandPink} />
      )}
      <View style={styles.itemBody}>
        <Text style={styles.text} numberOfLines={2}>
          {item.kind === 'voice' ? t('chatMenu.voice') : item.label}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {item.kind === 'image' && !allowed ? t('chatMenu.loadMedia') : item.url}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
export default React.memo(ChatAttachmentRow);
