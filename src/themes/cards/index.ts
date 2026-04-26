import { ImageStyle } from 'react-native';
import type { CardTheme } from '../../types/wallet';
import { bgStyle as albyStyle } from './alby';
import { bgStyle as bitcoinStyle } from './bitcoin';
import { bgStyle as defaultStyle } from './default';
import { bgStyle as lightningBeeStyle } from './lightning-bee';
import { bgStyle as lightningCatStyle } from './lightning-cat';
import { bgStyle as lightningCowStyle } from './lightning-cow';
import { bgStyle as lightningGoatStyle } from './lightning-goat';
import { bgStyle as lightningPiggyStyle } from './lightning-piggy';
import { bgStyle as lightningWhaleStyle } from './lightning-whale';
import { bgStyle as lnbitsStyle } from './lnbits';
import { bgStyle as nostrichStyle } from './nostrich';
import { bgStyle as coinosStyle } from './coinos';
import { bgStyle as primalStyle } from './primal';
import { bgStyle as revolutStyle } from './revolut';
import { bgStyle as xapoStyle } from './xapo';

// Typed as `Record<CardTheme | 'default', ...>` so adding a new theme
// to the `CardTheme` union forces a corresponding entry here at
// compile time. `'default'` lives outside `CardTheme` because it's
// the fallback when no theme is selected, not a user-pickable option.
const cardBgStyles: Record<CardTheme | 'default', ImageStyle> = {
  default: defaultStyle.full,
  'lightning-bee': lightningBeeStyle.full,
  'lightning-cat': lightningCatStyle.full,
  'lightning-cow': lightningCowStyle.full,
  'lightning-goat': lightningGoatStyle.full,
  nostrich: nostrichStyle.full,
  'lightning-piggy': lightningPiggyStyle.full,
  'lightning-whale': lightningWhaleStyle.full,
  bitcoin: bitcoinStyle.full,
  alby: albyStyle.full,
  lnbits: lnbitsStyle.full,
  primal: primalStyle.full,
  coinos: coinosStyle.full,
  revolut: revolutStyle.full,
  xapo: xapoStyle.full,
};

export function getCardBgStyle(
  styleName: CardTheme | undefined,
  _mini: boolean,
): ImageStyle {
  return cardBgStyles[styleName ?? 'default'] ?? cardBgStyles.default;
}
