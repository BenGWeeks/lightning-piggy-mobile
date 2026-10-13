import { useCallback } from 'react';
import { Linking } from 'react-native';
import { Alert } from '../components/BrandedAlert';
import { useTranslation } from '../contexts/LocaleContext';
import { relayExternalLink } from '../utils/relayExternalLink';

/** Same branded confirmation and caught platform open used by MarkdownText. */
export function useSafeExternalLink() {
  const t = useTranslation();
  return useCallback(
    (value: string) => {
      const url = relayExternalLink(value);
      if (!url) return;
      const parsed = new URL(url);
      Alert.alert(
        t('market.markdown.openLinkTitle'),
        t('market.markdown.openLinkBody', { host: parsed.host || url }),
        [
          { text: t('market.markdown.cancel'), style: 'cancel' },
          {
            text: t('market.markdown.open'),
            onPress: () => {
              void Linking.openURL(url).catch(() => {});
            },
          },
        ],
      );
    },
    [t],
  );
}
