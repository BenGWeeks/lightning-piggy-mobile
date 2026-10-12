import React, { useCallback, useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { UserRound } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createMentionPickerStyles } from '../styles/MentionPicker.styles';
import { isSupportedImageUrl } from '../utils/imageUrl';
import type { MentionCandidate } from '../utils/chatMentions';
import type { Palette } from '../styles/palettes';

type Styles = ReturnType<typeof createMentionPickerStyles>;

const MentionRow = React.memo(function MentionRow({
  member,
  onPick,
  styles,
  colors,
  label,
}: {
  member: MentionCandidate;
  onPick: (member: MentionCandidate) => void;
  styles: Styles;
  colors: Palette;
  label: string;
}) {
  const press = useCallback(() => onPick(member), [onPick, member]);
  const picture = member.picture && isSupportedImageUrl(member.picture) ? member.picture : null;
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`mention-option-${member.pubkey.slice(0, 12)}`}
    >
      <View style={styles.avatar}>
        {picture ? (
          <Image
            source={{ uri: picture }}
            style={styles.avatarImage}
            cachePolicy="memory-disk"
            recyclingKey={picture}
            autoplay={false}
            contentFit="cover"
          />
        ) : (
          <UserRound size={18} color={colors.textBody} strokeWidth={1.75} />
        )}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {member.name}
      </Text>
    </TouchableOpacity>
  );
});

/**
 * The composer's @mention picker (#1295): the group members matching what's
 * been typed after `@`, with avatar and name. At most a handful of rows (the
 * filter caps them), so a plain View rather than a list.
 */
function MentionPicker<T extends MentionCandidate>({
  candidates,
  onPick,
}: {
  candidates: readonly T[];
  onPick: (member: T) => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createMentionPickerStyles(colors), [colors]);
  const t = useTranslation();
  if (candidates.length === 0) return null;
  return (
    <View
      style={styles.container}
      testID="mention-picker"
      accessibilityLabel={t('chatMentions.picker')}
    >
      {candidates.map((member) => (
        <MentionRow
          key={member.pubkey}
          member={member}
          onPick={onPick as (member: MentionCandidate) => void}
          styles={styles}
          colors={colors}
          label={t('chatMentions.pickMember', { name: member.name })}
        />
      ))}
    </View>
  );
}

export default MentionPicker;
