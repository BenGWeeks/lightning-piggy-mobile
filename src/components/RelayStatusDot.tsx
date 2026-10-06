import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createRelayStatusDotStyles } from '../styles/RelayStatusDot.styles';

/** Green = connected, red = connection down, grey = the app isn't using this
 * relay right now (#1148). `status` is undefined when it isn't in the pool. */
function RelayStatusDot({ status, testID }: { status: boolean | undefined; testID?: string }) {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createRelayStatusDotStyles(colors), [colors]);
  const color =
    status === true ? colors.green : status === false ? colors.red : 'rgba(255,255,255,0.35)';
  const label =
    status === true
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
