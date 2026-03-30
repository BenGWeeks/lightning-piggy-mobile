import { ImageStyle } from 'react-native';
import { bgStyle as lightningPiggyStyle } from './lightning-piggy';
import { bgStyle as primalStyle } from './primal';
import { bgStyle as lnbitsStyle } from './lnbits';
import { bgStyle as nostrichStyle } from './nostrich';
import { bgStyle as lightningCatStyle } from './lightning-cat';
import { bgStyle as lightningGoatStyle } from './lightning-goat';
import { bgStyle as lightningWhaleStyle } from './lightning-whale';
import { bgStyle as defaultStyle } from './default';

const cardBgStyles: Record<string, ImageStyle> = {
  default: defaultStyle.full,
  'lightning-piggy': lightningPiggyStyle.full,
  primal: primalStyle.full,
  lnbits: lnbitsStyle.full,
  nostrich: nostrichStyle.full,
  'lightning-cat': lightningCatStyle.full,
  'lightning-goat': lightningGoatStyle.full,
  'lightning-whale': lightningWhaleStyle.full,
};

export function getCardBgStyle(styleName: string | undefined, _mini: boolean): ImageStyle {
  return cardBgStyles[styleName || 'default'] || cardBgStyles.default;
}
