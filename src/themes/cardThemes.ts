import { CardTheme } from '../types/wallet';
import { ImageSourcePropType } from 'react-native';

export interface CardThemeConfig {
  id: CardTheme;
  name: string;
  gradientColors: [string, string];
  textColor: string;
  accentColor: string;
  backgroundImage?: ImageSourcePropType;
  backgroundImageStyle?: string;
}

export const cardThemes: Record<CardTheme, CardThemeConfig> = {
  'lightning-piggy': {
    id: 'lightning-piggy',
    name: 'Lightning Piggy',
    gradientColors: ['#9B40FF', '#7A30F3'],
    textColor: '#FFFFFF',
    accentColor: '#FFD700',
    backgroundImage: require('../../assets/images/lightning-piggy-intro.png'),
    backgroundImageStyle: 'lightning-piggy',
  },
  primal: {
    id: 'primal',
    name: 'Primal',
    gradientColors: ['#222222', '#111111'],
    textColor: '#FFFFFF',
    accentColor: '#FA3C3C',
    backgroundImage: require('../../assets/images/primal-logo.png'),
    backgroundImageStyle: 'primal',
  },
  lnbits: {
    id: 'lnbits',
    name: 'LNbits',
    gradientColors: ['#2D1B4E', '#080910'],
    textColor: '#FFFFFF',
    accentColor: '#FF1EE6',
    backgroundImage: require('../../assets/images/lnbits-logo.png'),
    backgroundImageStyle: 'lnbits',
  },
  nostrich: {
    id: 'nostrich',
    name: 'Nostrich',
    gradientColors: ['#9B30FF', '#6B1FA2'],
    textColor: '#FFFFFF',
    accentColor: '#E040FB',
    backgroundImage: require('../../assets/images/nostrich.png'),
    backgroundImageStyle: 'nostrich',
  },
  'lightning-cat': {
    id: 'lightning-cat',
    name: 'Lightning Cat',
    gradientColors: ['#E65100', '#BF360C'],
    textColor: '#FFFFFF',
    accentColor: '#FFAB40',
    backgroundImage: require('../../assets/images/lightning-cat.png'),
    backgroundImageStyle: 'lightning-cat',
  },
  'lightning-goat': {
    id: 'lightning-goat',
    name: 'Lightning Goat',
    gradientColors: ['#1565C0', '#0D47A1'],
    textColor: '#FFFFFF',
    accentColor: '#64B5F6',
    backgroundImage: require('../../assets/images/lightning-goat.png'),
    backgroundImageStyle: 'lightning-goat',
  },
  'lightning-whale': {
    id: 'lightning-whale',
    name: 'Lightning Whale',
    gradientColors: ['#0277BD', '#01579B'],
    textColor: '#FFFFFF',
    accentColor: '#4FC3F7',
    backgroundImage: require('../../assets/images/lightning-whale.png'),
    backgroundImageStyle: 'lightning-whale',
  },
};

export const themeList = Object.values(cardThemes);
