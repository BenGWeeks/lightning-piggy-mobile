import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createRelayStatusDotStyles } from '../styles/RelayStatusDot.styles';

/** Reachability is independent of pool membership. Legacy advanced rows retain pool labels. */
function RelayStatusDot({
  status,
  testID,
  probe = false,
}: {
  status: boolean | undefined;
  testID?: string;
  probe?: boolean;
}) {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createRelayStatusDotStyles(colors), [colors]);
  const color =
    status === true ? colors.green : status === false ? colors.red : 'rgba(255,255,255,0.35)';
  const label = probe
    ? t(
        status === true
          ? 'relayReachability.reachable'
          : status === false
            ? 'relayReachability.unreachable'
            : 'relayReachability.checking',
      )
    : status === true
      ? t('nostrScreen.connected')
      : status === false
        ? t('nostrScreen.disconnected')
        : t('nostrScreen.notInUse');
  return (
    <View
      style={[styles.dot, { backgroundColor: color }]}
      accessible
      accessibilityLabel={label}
      testID={testID}
    />
  );
}

export default React.memo(RelayStatusDot);
