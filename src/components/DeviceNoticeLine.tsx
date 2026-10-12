import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from '../contexts/LocaleContext';
import type { Palette } from '../styles/palettes';
import { createDeviceNoticeLineStyles } from '../styles/DeviceNoticeLine.styles';
import { formatTime } from '../utils/messageContent';
import { appsSummary } from '../utils/marmotDeviceView';

interface Props {
  id: string;
  /** Unix seconds: when this phone processed the commit. */
  createdAt: number;
  /** Who it's about ("You" for the viewer). */
  name: string;
  /** Newly in the chat, vs. a device added later. */
  joined: boolean;
  /** The app each new device runs (null = unknown). */
  clients: readonly (string | null)[];
  colors: Palette;
}

/**
 * Alpha-only grey system line in a Marmot chat (#1267): "Little Piggy · joined
 * on 2 devices (Lightning Piggy ×2)". Drawn locally from a commit this phone
 * processed; never sent, so nobody else's chat changes. Behind the
 * "Show device changes in chats" developer switch.
 */
const DeviceNoticeLine: React.FC<Props> = ({ id, createdAt, name, joined, clients, colors }) => {
  const t = useTranslation();
  const styles = useMemo(() => createDeviceNoticeLineStyles(colors), [colors]);
  const text = t(joined ? 'chatDevices.noticeJoined' : 'chatDevices.noticeAdded', {
    name,
    count: clients.length,
    apps: appsSummary(clients, t('chatDevices.unknownApp')),
  });
  return (
    <View style={styles.row} testID={`device-notice-${id}`} accessible accessibilityLabel={text}>
      <Text style={styles.text}>
        {text} · {formatTime(createdAt)}
      </Text>
    </View>
  );
};

export default React.memo(DeviceNoticeLine);
