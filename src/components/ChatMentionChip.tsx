import React, { useCallback, useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMentionProfile } from '../hooks/useMentionProfile';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { pubkeyToContactBodyStub } from '../utils/nostrProfileLink';
import { shortNpubLabel } from '../utils/nip27';
import { createChatMentionChipStyles } from '../styles/ChatMentionChip.styles';
import type { RootStackParamList } from '../navigation/types';

/**
 * Inline `@Name` chip for a mention in a chat bubble (#1295) — the chat
 * variant of `components/nostr/MentionChip` (#1334): the same batched name
 * lookup (`useMentionProfile`), testID (`nostr-mention-<pubkey prefix>`),
 * label and tap → push the profile, plus inverse colours for the pink sent
 * bubble, which the profile-feed chip doesn't need.
 *
 * An inline View rather than a nested Text span, so it's a real touch target
 * with its own testID / accessibility node.
 */
const ChatMentionChip: React.FC<{ pubkey: string; fromMe: boolean }> = ({ pubkey, fromMe }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createChatMentionChipStyles(colors), [colors]);
  const t = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { name, picture } = useMentionProfile(pubkey);
  const label = `@${name?.trim() || shortNpubLabel(pubkey)}`;

  const open = useCallback(() => {
    const stub = pubkeyToContactBodyStub(pubkey);
    navigation.push('ContactProfile', {
      contact: { ...stub, name: name?.trim() || stub.name, picture: picture ?? null },
    });
  }, [navigation, pubkey, name, picture]);

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        onPress={open}
        accessibilityRole="link"
        accessibilityLabel={t('nostrContent.openProfile', { name: label })}
        testID={`nostr-mention-${pubkey.slice(0, 12)}`}
        hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
        style={[styles.chip, fromMe && styles.chipMe]}
      >
        <Text style={[styles.text, fromMe && styles.textMe]} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

export default React.memo(ChatMentionChip);
