import type { SearchableMessage } from '../utils/chatSearch';
import React, { useCallback, useMemo, useState } from 'react';
import { SectionList, Text, TouchableOpacity, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/types';
import { useThemeColors } from '../contexts/ThemeContext';
import { useLocale } from '../contexts/LocaleContext';
import { useNostr } from '../contexts/NostrContext';
import { useFollowedPubkeys } from '../hooks/useFollowedPubkeys';
import { canAutoLoadChatMedia } from '../utils/mediaTrust';
import { createChatToolsStyles } from '../styles/ChatTools.styles';
import {
  extractChatAttachments,
  groupAttachmentsByMonth,
  type AttachmentTab,
  type ChatAttachment,
} from '../utils/chatAttachments';
import ChatAttachmentRow from '../components/ChatAttachmentRow';
import FullscreenGifModal from '../components/FullscreenGifModal';
const EMPTY_MESSAGES: SearchableMessage[] = [];
const tabs: AttachmentTab[] = ['media', 'docs', 'links'];
export default function ChatMediaScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'ChatMedia'>>();
  const snapshot = params.messages ?? EMPTY_MESSAGES;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const colors = useThemeColors();
  const { t, formatLocale } = useLocale();
  const insets = useSafeAreaInsets();
  const followed = useFollowedPubkeys();
  const { pubkey } = useNostr();
  const styles = useMemo(() => createChatToolsStyles(colors), [colors]);
  const [tab, setTab] = useState<AttachmentTab>('media');
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const items = useMemo(() => extractChatAttachments(snapshot), [snapshot]);
  const sections = useMemo(
    () =>
      groupAttachmentsByMonth(
        items.filter((item) => item.tab === tab),
        formatLocale,
      ),
    [items, tab, formatLocale],
  );
  const messages = useMemo(() => new Map(snapshot.map((m) => [m.id, m])), [snapshot]);
  const jump = useCallback(
    (id: string) => {
      if (params.target.screen === 'Conversation')
        navigation.popTo('Conversation', { ...params.target.params, jumpToMessage: id });
      else navigation.popTo('GroupConversation', { ...params.target.params, jumpToMessage: id });
    },
    [navigation, params.target],
  );
  const renderItem = useCallback(
    ({ item }: { item: ChatAttachment }) => {
      const m = messages.get(item.messageId);
      const sender =
        m?.senderPubkey ??
        (params.target.screen === 'Conversation' ? params.target.params.pubkey : '');
      return (
        <ChatAttachmentRow
          item={item}
          autoLoad={canAutoLoadChatMedia(m?.fromMe, sender, followed, pubkey)}
          onOpen={setFullscreen}
          onJump={jump}
        />
      );
    },
    [messages, params.target, followed, jump, pubkey],
  );
  return (
    <View
      style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      testID="chat-media-screen"
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.goBack()}
          testID="chat-media-back"
          accessibilityLabel={t('conversationScreen.goBack')}
        >
          <ArrowLeft size={24} color={colors.textHeader} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('chatMenu.allMedia')}</Text>
      </View>
      <View style={styles.tabs}>
        {tabs.map((value) => (
          <TouchableOpacity
            key={value}
            style={[styles.tab, tab === value && styles.activeTab]}
            testID={`chat-media-tab-${value}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: value === tab }}
            onPress={() => setTab(value)}
          >
            <Text style={tab === value ? styles.action : styles.text}>
              {t(`chatMenu.${value}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => <Text style={styles.month}>{section.title}</Text>}
        ListEmptyComponent={<Text style={styles.empty}>{t('chatMenu.empty')}</Text>}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={5}
      />
      <FullscreenGifModal
        url={fullscreen}
        onClose={() => setFullscreen(null)}
        closeLabel={t('chatMenu.close')}
        testID="chat-media-viewer-close"
      />
    </View>
  );
}
