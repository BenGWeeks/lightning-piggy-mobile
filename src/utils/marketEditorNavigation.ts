import type { RootStackParamList } from '../navigation/types';

export function marketEditorDestination(dTag?: string): RootStackParamList['Main'] {
  return {
    screen: 'MainTabs',
    params: { screen: 'Explore', params: { screen: 'MarketListingEditor', params: { dTag } } },
  };
}
