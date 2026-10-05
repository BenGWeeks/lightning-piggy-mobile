import React, { useCallback, useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import DmProtocolTag from './DmProtocolTag';
import DmProtocolPickerSheet from './DmProtocolPickerSheet';
import { isDmProtocolAvailable, type DmProtocol } from '../utils/dmProtocol';

export default function ConversationProtocolControl({ protocol }: { protocol: DmProtocol }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Conversation'>>();
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const select = useCallback(
    (value: DmProtocol) => {
      if (!isDmProtocolAvailable(value)) return;
      close();
      if (value !== protocol) {
        navigation.replace('Conversation', { ...route.params, protocol: value });
      }
    },
    [navigation, route.params, protocol, close],
  );
  return (
    <>
      <DmProtocolTag protocol={protocol} onPress={open} testID="conversation-protocol-tag" />
      <DmProtocolPickerSheet
        visible={visible}
        selected={protocol}
        onSelect={select}
        onClose={close}
      />
    </>
  );
}
