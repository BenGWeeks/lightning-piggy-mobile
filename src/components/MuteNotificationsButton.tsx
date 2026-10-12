import React, { useMemo } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { BellOff, BellRing } from 'lucide-react-native';
import { useMutedSenders } from '../hooks/useMutedSenders';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import Toast from './BrandedToast';
import { createMuteNotificationsStyles } from '../styles/MuteNotifications.styles';

function MuteNotificationsButton({ pubkey, testID }: { pubkey: string; testID: string }) {
  const { mutedSenders, ready, toggle } = useMutedSenders();
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMuteNotificationsStyles(colors), [colors]);
  const muted = mutedSenders.has(pubkey.toLowerCase());
  const label = t(muted ? 'notificationMute.unmute' : 'notificationMute.mute');
  const Icon = muted ? BellRing : BellOff;
  return (
    <TouchableOpacity
      style={styles.button}
      disabled={!ready}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={() => {
        void toggle(pubkey).catch(() =>
          Toast.show({ type: 'error', text1: t('notificationMute.error') }),
        );
      }}
    >
      <Icon size={20} color={colors.textBody} />
      <Text style={styles.text}>{label}</Text>
    </TouchableOpacity>
  );
}
export default React.memo(MuteNotificationsButton);
