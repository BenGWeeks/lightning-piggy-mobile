import React, { useCallback, useState } from 'react';
import DmProtocolTag from './DmProtocolTag';
import DmProtocolPickerSheet from './DmProtocolPickerSheet';
import { isDmProtocolAvailable, type DmProtocol } from '../utils/dmProtocol';

export default function ConversationProtocolControl({
  protocol,
  onSelect,
}: {
  protocol: DmProtocol;
  onSelect: (protocol: DmProtocol) => void;
}) {
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const select = useCallback(
    (value: DmProtocol) => {
      if (!isDmProtocolAvailable(value)) return;
      onSelect(value);
      close();
    },
    [onSelect, close],
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
