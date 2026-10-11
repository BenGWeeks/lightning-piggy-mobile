import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Check, UserPlus, UserRound, X } from 'lucide-react-native';
import { useTranslation } from '../contexts/LocaleContext';
import type { Palette } from '../styles/palettes';
import type { GroupMembersSheetStyles } from '../styles/GroupMembersSheet.styles';
import type { GroupMemberRow } from '../utils/groupMemberRows';
import { isSupportedImageUrl } from '../utils/imageUrl';

interface Props {
  member: GroupMemberRow;
  styles: GroupMembersSheetStyles;
  colors: Palette;
  canRemove: boolean;
  /** This row's Follow is publishing. */
  followPending: boolean;
  /** Another row's Follow is publishing — follows are single-flight. */
  followDisabled: boolean;
  onPress?: (member: GroupMemberRow) => void;
  onRemove: (member: GroupMemberRow) => void;
  onFollow: (member: GroupMemberRow) => void;
}

/**
 * One member row in `GroupMembersSheet`: avatar, name, follow status
 * (Following marker / Follow button, never on the self row — #1268) and the
 * admin-only Remove button. Memoised; every handler takes the row back so the
 * parent can pass stable callbacks.
 */
const GroupMemberListRow: React.FC<Props> = ({
  member,
  styles,
  colors,
  canRemove,
  followPending,
  followDisabled,
  onPress,
  onRemove,
  onFollow,
}) => {
  const t = useTranslation();
  const tid = member.pubkey.slice(0, 12);
  const tappable = !!onPress && !member.isSelf;
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={tappable ? () => onPress(member) : undefined}
      activeOpacity={tappable ? 0.6 : 1}
      accessibilityLabel={t('groupMembersSheet.viewProfile', { name: member.name })}
      testID={`group-member-row-${tid}`}
    >
      <View style={styles.avatar}>
        {member.picture && isSupportedImageUrl(member.picture) ? (
          <Image
            source={{ uri: member.picture }}
            style={styles.avatarImage}
            cachePolicy="memory-disk"
            recyclingKey={member.picture}
            autoplay={false}
          />
        ) : (
          <UserRound size={22} color={colors.textBody} strokeWidth={1.75} />
        )}
      </View>
      <Text style={styles.rowName} numberOfLines={1}>
        {member.name}
        {member.isSelf ? <Text style={styles.youTag}>{t('groupMembersSheet.youTag')}</Text> : null}
      </Text>
      {member.isSelf ? null : member.following ? (
        <View
          style={styles.followingMarker}
          accessible
          accessibilityLabel={t('groupMembersSheet.followingA11y', { name: member.name })}
          testID={`group-member-following-${tid}`}
        >
          <Check size={14} color={colors.textSupplementary} strokeWidth={2.5} />
          <Text style={styles.followingText}>{t('groupMembersSheet.following')}</Text>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.followButton, followDisabled && styles.followButtonDisabled]}
          onPress={() => onFollow(member)}
          disabled={followPending || followDisabled}
          accessibilityRole="button"
          accessibilityLabel={t('groupMembersSheet.followMember', { name: member.name })}
          accessibilityState={{ busy: followPending, disabled: followPending || followDisabled }}
          testID={`group-member-follow-${tid}`}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          {followPending ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <UserPlus size={14} color={colors.white} strokeWidth={2.5} />
              <Text style={styles.followButtonText}>{t('groupMembersSheet.follow')}</Text>
            </>
          )}
        </TouchableOpacity>
      )}
      {canRemove && !member.isSelf ? (
        <TouchableOpacity
          style={styles.removeButton}
          onPress={() => onRemove(member)}
          accessibilityLabel={t('groupMembersSheet.removeMember', { name: member.name })}
          testID={`group-member-remove-${tid}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <X size={18} color={colors.brandPink} strokeWidth={2.5} />
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
};

export default React.memo(GroupMemberListRow);
