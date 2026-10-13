import React, { useMemo } from 'react';
import { View } from 'react-native';
import ChatMenu, { type ChatMenuProps } from './ChatMenu';
import { useThemeColors } from '../contexts/ThemeContext';
import DmProtocolTag from './DmProtocolTag';
import { groupDmProtocol } from '../utils/groupProtocol';
import type { Group } from '../types/groups';
import { createGroupHeaderActionsStyles } from '../styles/GroupHeaderActions.styles';

interface Props {
  group: Pick<Group, 'protocol'>;
  menu: ChatMenuProps;
}

/** Right-hand side of the group chat header: the group's protocol tag
 * (read-only — a group's transport is fixed, unlike a 1:1 thread's) and the
 * chat menu. */
function GroupHeaderActions({ group, menu }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createGroupHeaderActionsStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <DmProtocolTag protocol={groupDmProtocol(group)} testID="group-protocol-tag" />
      <ChatMenu {...menu} />
    </View>
  );
}

export default React.memo(GroupHeaderActions);
