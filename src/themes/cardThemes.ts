import { CardTheme } from '../types/wallet';
import { ImageSourcePropType } from 'react-native';

export interface CardThemeConfig {
  id: CardTheme;
  name: string;
  gradientColors: [string, string];
  textColor: string;
  accentColor: string;
  backgroundImage?: ImageSourcePropType;
}

export const cardThemes: Record<CardTheme, CardThemeConfig> = {
  'lightning-piggy': {
    id: 'lightning-piggy',
    name: 'Lightning Piggy',
    gradientColors: ['#9B40FF', '#7A30F3'],
    textColor: '#FFFFFF',
    accentColor: '#FFD700',
    backgroundImage: require('../../assets/images/lightning-piggy-intro.png'),
  },
  primal: {
    id: 'primal',
    name: 'Primal',
    gradientColors: ['#222222', '#111111'],
    textColor: '#FFFFFF',
    accentColor: '#F7931A',
  },
  lnbits: {
    id: 'lnbits',
    name: 'LNbits',
    gradientColors: ['#4B0082', '#2D004F'],
    textColor: '#FFFFFF',
    accentColor: '#EEFF41',
  },
  nostrich: {
    id: 'nostrich',
    name: 'Nostrich',
    gradientColors: ['#9B30FF', '#6B1FA2'],
    textColor: '#FFFFFF',
    accentColor: '#E040FB',
  },
  generic: {
    id: 'generic',
    name: 'Classic',
    gradientColors: ['#37474F', '#263238'],
    textColor: '#FFFFFF',
    accentColor: '#64B5F6',
  },
};

export const themeList = Object.values(cardThemes);
