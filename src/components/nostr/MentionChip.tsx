import React, { useCallback } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMentionProfile } from '../../hooks/useMentionProfile';
import { useTranslation } from '../../contexts/LocaleContext';
import { pubkeyToContactBodyStub } from '../../utils/nostrProfileLink';
import { shortNpubLabel } from '../../utils/nip27';
import type { RootStackParamList } from '../../navigation/types';
import type { NostrContentStyles } from '../../styles/NostrContent.styles';

interface Props {
  pubkey: string;
  styles: NostrContentStyles;
  testID?: string;
}

/**
 * Inline `@Name` chip for a NIP-27 `nostr:npub…` / `nprofile…` mention. The
 * name comes from the shared profile cache (`useMentionProfile`: a shared, bounded,
 * focus-owned cosmetic batch), with a short npub
 * until it resolves. Tapping pushes that person's profile, so Back returns
 * to where the mention was.
 *
 * An inline View (not a nested Text span) so it can be a rounded chip and a
 * real touch target with its own testID / accessibility node.
 */
const MentionChip: React.FC<Props> = ({ pubkey, styles, testID }) => {
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
    <View style={styles.mentionWrap}>
      <TouchableOpacity
        onPress={open}
        accessibilityRole="link"
        accessibilityLabel={t('nostrContent.openProfile', { name: label })}
        testID={testID ?? `nostr-mention-${pubkey.slice(0, 12)}`}
        hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
        style={styles.mentionChip}
      >
        <Text style={styles.mentionText} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

export default React.memo(MentionChip);
