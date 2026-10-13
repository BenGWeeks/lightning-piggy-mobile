import { useCallback } from 'react';
import { useMutedSenders } from './useMutedSenders';
import { useTranslation } from '../contexts/LocaleContext';
import { Alert } from '../components/BrandedAlert';
import Toast from '../components/BrandedToast';

export function useMuteNotificationAction() {
  const { mutedSenders, ready, toggle } = useMutedSenders();
  const t = useTranslation();
  return useCallback(
    (sender: string, testID: string) => {
      if (!ready) return;
      const muted = mutedSenders.has(sender.toLowerCase());
      const title = t(
        sender.startsWith('group:')
          ? muted
            ? 'chatMenu.unmute'
            : 'chatMenu.mute'
          : muted
            ? 'notificationMute.unmute'
            : 'notificationMute.mute',
      );
      const label = t(muted ? 'notificationMute.unmuteAction' : 'notificationMute.muteAction');
      Alert.alert(title, undefined, [
        { text: t('addWalletWizard.cancel'), style: 'cancel' },
        {
          text: label,
          testID,
          onPress: () => {
            void toggle(sender).catch(() =>
              Toast.show({ type: 'error', text1: t('notificationMute.error') }),
            );
          },
        },
      ]);
    },
    [mutedSenders, ready, toggle, t],
  );
}
