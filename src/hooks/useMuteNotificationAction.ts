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
      const label = t(
        mutedSenders.has(sender.toLowerCase())
          ? 'notificationMute.unmute'
          : 'notificationMute.mute',
      );
      Alert.alert(label, undefined, [
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
