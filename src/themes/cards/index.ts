import { ImageStyle } from 'react-native';
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
import { bgStyle as primalStyle } from './primal';

const cardBgStyles: Record<string, ImageStyle> = {
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
};

export function getCardBgStyle(styleName: string | undefined, _mini: boolean): ImageStyle {
  return cardBgStyles[styleName || 'default'] || cardBgStyles.default;
}
