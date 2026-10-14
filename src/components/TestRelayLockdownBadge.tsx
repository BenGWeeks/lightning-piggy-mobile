import React, { useMemo } from 'react';
import { Text } from 'react-native';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { isTestRelayLockdown, TEST_RELAY_URL } from '../config/testRelayLockdown';
import { createTestRelayLockdownBadgeStyles } from '../styles/TestRelayLockdownBadge.styles';

export default function TestRelayLockdownBadge() {
  const { pubkey } = useNostr();
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createTestRelayLockdownBadgeStyles(colors), [colors]);
  if (!isTestRelayLockdown(pubkey)) return null;
  return (
    <Text style={styles.badge} testID="test-relay-lockdown-badge">
      {t('nostrScreen.testRelayLockdown', { url: TEST_RELAY_URL })}
    </Text>
  );
}
