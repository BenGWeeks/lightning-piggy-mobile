import React, { useMemo } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { LogOut } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import DmProtocolTag from './DmProtocolTag';
import { groupDmProtocol } from '../utils/groupProtocol';
import type { Group } from '../types/groups';
import { createGroupHeaderActionsStyles } from '../styles/GroupHeaderActions.styles';

interface Props {
  group: Pick<Group, 'protocol'>;
  onLeave: () => void;
}

/** Right-hand side of the group chat header: the group's protocol tag
 * (read-only — a group's transport is fixed, unlike a 1:1 thread's) and the
 * leave button. */
function GroupHeaderActions({ group, onLeave }: Props) {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createGroupHeaderActionsStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <DmProtocolTag protocol={groupDmProtocol(group)} testID="group-protocol-tag" />
      <TouchableOpacity
        style={styles.leaveButton}
        onPress={onLeave}
        accessibilityLabel={t('groupConversationScreen.leaveGroupTitle')}
        testID="leave-group-button"
      >
        <LogOut size={18} color={colors.white} strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );
}

export default React.memo(GroupHeaderActions);
