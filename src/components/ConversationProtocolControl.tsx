import React, { useCallback, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import DmProtocolTag from './DmProtocolTag';
import DmProtocolPickerSheet from './DmProtocolPickerSheet';
import { isDmProtocolAvailable, type DmProtocol } from '../utils/dmProtocol';

export default function ConversationProtocolControl({ protocol }: { protocol: DmProtocol }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const select = useCallback(
    (value: DmProtocol) => {
      if (!isDmProtocolAvailable(value)) return;
      close();
      if (value !== protocol) {
        // Switch in place rather than replace(): the picker is a sheet portalled
        // to the app root, and unmounting its screen mid-dismiss orphaned its
        // backdrop over the new thread, swallowing taps (e.g. Back). The loader
        // already handles a protocol change on a reused screen.
        navigation.setParams({ protocol: value });
      }
    },
    [navigation, protocol, close],
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
