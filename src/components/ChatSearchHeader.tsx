import React, { useMemo } from 'react';
import { TextInput, Text, TouchableOpacity, View } from 'react-native';
import { ArrowLeft, ChevronUp, ChevronDown } from 'lucide-react-native';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createChatToolsStyles } from '../styles/ChatTools.styles';
import type { useChatSearch } from '../hooks/useChatSearch';
export default function ChatSearchHeader({
  search,
  topInset = 0,
}: {
  search: ReturnType<typeof useChatSearch>;
  topInset?: number;
}) {
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createChatToolsStyles(colors, topInset), [colors, topInset]);
  return (
    <View style={styles.searchContainer}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.button}
          onPress={search.close}
          testID="chat-search-close"
          accessibilityLabel={t('chatMenu.close')}
        >
          <ArrowLeft color={colors.textHeader} size={22} />
        </TouchableOpacity>
        <TextInput
          autoFocus
          style={styles.input}
          testID="chat-search-input"
          accessibilityLabel={t('chatMenu.search')}
          placeholder={t('chatMenu.search')}
          placeholderTextColor={colors.textSupplementary}
          value={search.query}
          onChangeText={search.change}
        />
        <Text testID="chat-search-count" style={styles.muted}>
          {t('chatMenu.matchCount', {
            current: search.count ? search.index + 1 : 0,
            total: search.count,
          })}
        </Text>
        <TouchableOpacity
          style={styles.button}
          disabled={search.index >= search.count - 1}
          onPress={() => search.move(1)}
          testID="chat-search-up"
          accessibilityLabel={t('chatMenu.previous')}
        >
          <ChevronUp color={colors.brandPink} size={22} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.button}
          disabled={!search.index}
          onPress={() => search.move(-1)}
          testID="chat-search-down"
          accessibilityLabel={t('chatMenu.next')}
        >
          <ChevronDown color={colors.brandPink} size={22} />
        </TouchableOpacity>
      </View>
      <Text style={styles.month}>{t('chatMenu.searchLoaded')}</Text>
    </View>
  );
}
