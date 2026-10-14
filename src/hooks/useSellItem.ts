import { useCallback } from 'react';
import { useTranslation } from '../contexts/LocaleContext';
import { Alert } from '../components/BrandedAlert';
import { Toast } from '../components/BrandedToast';
import { sellGate, type SellerFetchStatus } from '../utils/shopSellGate';
import type { ExploreNavigation } from '../navigation/types';

/**
 * "Sell an item" with the shipping gate (#1534). If the shop has no shipping
 * options, the seller is asked to add some first, or to say the item is
 * digital (digital items need no shipping). If the shop couldn't be loaded,
 * the usual retry shows instead: unknown is never treated as "none".
 *
 * Takes the caller's `useSellerShop` values so a screen keeps a single
 * seller fetch.
 */
export function useSellItem({
  navigation,
  zoneCount,
  status,
  refresh,
}: {
  navigation: ExploreNavigation;
  zoneCount: number;
  status: SellerFetchStatus;
  refresh: () => void;
}): () => void {
  const t = useTranslation();
  return useCallback(() => {
    const gate = sellGate({ zoneCount, status });
    if (gate === 'open') {
      navigation.navigate('MarketListingEditor');
      return;
    }
    if (gate === 'unknown') {
      if (status === 'error') {
        Toast.show({ type: 'error', text1: t('market.sell.loadFailedTryAgain') });
        refresh();
      } else {
        Toast.show({ type: 'info', text1: t('market.sell.loading') });
      }
      return;
    }
    Alert.alert(t('market.sell.gate.title'), t('market.sell.gate.body'), [
      {
        text: t('market.sell.gate.addShipping'),
        onPress: () => navigation.navigate('MarketShopShipping'),
      },
      {
        text: t('market.sell.gate.digital'),
        onPress: () => navigation.navigate('MarketListingEditor', { digital: true }),
      },
      { text: t('market.sell.cancel'), style: 'cancel' },
    ]);
  }, [navigation, zoneCount, status, refresh, t]);
}
