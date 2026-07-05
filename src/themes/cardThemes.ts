import type { CardTheme, WalletType } from '../types/wallet';
import { ImageSourcePropType, ImageResizeMode } from 'react-native';

export interface CardThemeConfig {
  id: CardTheme;
  name: string;
  gradientColors: [string, string];
  textColor: string;
  accentColor: string;
  backgroundImage?: ImageSourcePropType;
  // Tighter than `string`: must be one of the registered cards/* style
  // names so a typo doesn't silently fall back to the default style.
  backgroundImageStyle?: CardTheme;
  // Defaults to 'contain' (line-art mascots sit as a corner decoration
  // over the gradient). Full-bleed photo backgrounds set 'stretch' (or
  // 'cover') so the art fills the whole card with no gradient gap at the
  // edges.
  backgroundImageResizeMode?: ImageResizeMode;
}

export const cardThemes: Record<CardTheme, CardThemeConfig> = {
  'lightning-piggy': {
    id: 'lightning-piggy',
    name: 'Piggy',
    gradientColors: ['#9B40FF', '#7A30F3'],
    textColor: '#FFFFFF',
    accentColor: '#FFD700',
    backgroundImage: require('../../assets/images/lightning-piggy-intro.png'),
    backgroundImageStyle: 'lightning-piggy',
  },
  'lightning-bee': {
    id: 'lightning-bee',
    name: 'Bee',
    gradientColors: ['#FFCA28', '#F9A825'],
    textColor: '#FFFFFF',
    accentColor: '#FFFFFF',
    backgroundImage: require('../../assets/images/lightning-bee.png'),
    backgroundImageStyle: 'lightning-bee',
  },
  'lightning-cat': {
    id: 'lightning-cat',
    name: 'Cat',
    gradientColors: ['#E65100', '#BF360C'],
    textColor: '#FFFFFF',
    accentColor: '#FFAB40',
    backgroundImage: require('../../assets/images/lightning-cat.png'),
    backgroundImageStyle: 'lightning-cat',
  },
  bitpopart: {
    id: 'bitpopart',
    name: 'BitPopArt',
    gradientColors: ['#D81B8C', '#3A1E6E'],
    textColor: '#FFFFFF',
    accentColor: '#FFE600',
    backgroundImage: require('../../assets/images/bitpopart.png'),
    backgroundImageStyle: 'bitpopart',
    backgroundImageResizeMode: 'stretch',
  },
  'lightning-cow': {
    id: 'lightning-cow',
    name: 'Cow',
    gradientColors: ['#2E7D32', '#1B5E20'],
    textColor: '#FFFFFF',
    accentColor: '#81C784',
    backgroundImage: require('../../assets/images/lightning-cow.png'),
    backgroundImageStyle: 'lightning-cow',
  },
  'lightning-goat': {
    id: 'lightning-goat',
    name: 'Goat',
    gradientColors: ['#1565C0', '#0D47A1'],
    textColor: '#FFFFFF',
    accentColor: '#64B5F6',
    backgroundImage: require('../../assets/images/lightning-goat.png'),
    backgroundImageStyle: 'lightning-goat',
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
  'lightning-whale': {
    id: 'lightning-whale',
    name: 'Whale',
    gradientColors: ['#0277BD', '#01579B'],
    textColor: '#FFFFFF',
    accentColor: '#4FC3F7',
    backgroundImage: require('../../assets/images/lightning-whale.png'),
    backgroundImageStyle: 'lightning-whale',
  },
  bitcoin: {
    id: 'bitcoin',
    name: 'Bitcoin',
    gradientColors: ['#F7931A', '#E67E00'],
    textColor: '#FFFFFF',
    accentColor: '#FFFFFF',
    backgroundImage: require('../../assets/images/bitcoin-logo.png'),
    backgroundImageStyle: 'bitcoin',
  },
  alby: {
    id: 'alby',
    name: 'Alby',
    gradientColors: ['#FFDE6E', '#F5C829'],
    textColor: '#000000',
    accentColor: '#FFFFFF',
    backgroundImage: require('../../assets/images/alby-logo.png'),
    backgroundImageStyle: 'alby',
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
  primal: {
    id: 'primal',
    name: 'Primal',
    gradientColors: ['#222222', '#111111'],
    textColor: '#FFFFFF',
    accentColor: '#FA3C3C',
    backgroundImage: require('../../assets/images/primal-logo.png'),
    backgroundImageStyle: 'primal',
  },
  coinos: {
    id: 'coinos',
    name: 'CoinOS',
    gradientColors: ['#1A1A2E', '#0A0A0A'],
    textColor: '#FFFFFF',
    accentColor: '#CCCCCC',
    backgroundImage: require('../../assets/images/coinos-logo.png'),
    backgroundImageStyle: 'coinos',
  },
  revolut: {
    id: 'revolut',
    name: 'Revolut',
    gradientColors: ['#1A1A2E', '#000000'],
    textColor: '#FFFFFF',
    accentColor: '#A57DFF',
    // TODO: revolut-logo.png is a PLACEHOLDER (ImageMagick-rendered
    // DejaVu-Sans-Bold "Revolut" wordmark — revolut.com aggressively
    // blocks bot fetches so we couldn't pull the real asset). Swap in
    // an officially-sourced wordmark before any wide distribution. The
    // bgStyle box is sized to the placeholder's ~3.33:1 aspect (70×21dp)
    // and pinned bottom-right at opacity 0.85 — see src/themes/cards/revolut.ts.
    // A replacement asset with a *different* aspect ratio will need that
    // bgStyle updated to match, or the card will look off.
    backgroundImage: require('../../assets/images/revolut-logo.png'),
    backgroundImageStyle: 'revolut',
  },
  xapo: {
    id: 'xapo',
    name: 'Xapo',
    gradientColors: ['#0030B0', '#001440'],
    textColor: '#FFFFFF',
    accentColor: '#4D8DFF',
    backgroundImage: require('../../assets/images/xapo-logo.png'),
    backgroundImageStyle: 'xapo',
  },
  // Sports-themed cards (#102). Graffiti-style transparent illustrations
  // sit over the sport's palette gradient, matching the animal cards.
  // The per-theme positioning lives in `src/themes/cards/<sport>.ts`.
  tennis: {
    id: 'tennis',
    name: 'Tennis',
    // Lime-green court + crisp white line — classic tennis palette.
    gradientColors: ['#A8E063', '#56AB2F'],
    textColor: '#FFFFFF',
    accentColor: '#FFFFFF',
    backgroundImage: require('../../assets/images/tennis.png'),
    backgroundImageStyle: 'tennis',
  },
  football: {
    id: 'football',
    name: 'Football',
    // Forest pitch + emerald grass — soccer feel without club IP.
    gradientColors: ['#1B5E20', '#2E7D32'],
    textColor: '#FFFFFF',
    accentColor: '#A5D6A7',
    backgroundImage: require('../../assets/images/football.png'),
    backgroundImageStyle: 'football',
  },
  basketball: {
    id: 'basketball',
    name: 'Basketball',
    // Orange ball + black seam contrast.
    gradientColors: ['#F57C00', '#E65100'],
    textColor: '#FFFFFF',
    accentColor: '#212121',
    backgroundImage: require('../../assets/images/basketball.png'),
    backgroundImageStyle: 'basketball',
  },
  f1: {
    id: 'f1',
    name: 'Formula 1',
    // Dark asphalt track surface — charcoal tarmac fading to near-black,
    // with chequered-flag red accent.
    gradientColors: ['#46494D', '#161719'],
    textColor: '#FFFFFF',
    accentColor: '#E53935',
    backgroundImage: require('../../assets/images/f1.png'),
    backgroundImageStyle: 'f1',
  },
  spaceship: {
    id: 'spaceship',
    name: 'Spaceship',
    // Full-bleed graffiti nebula (rocket to the right). The gradient is only
    // a fallback tint behind the art — deep violet cosmic cloud fading to the
    // black of space, matching the nebula so any load gap isn't jarring.
    gradientColors: ['#2B1055', '#080312'],
    textColor: '#FFFFFF',
    accentColor: '#7DE2FC',
    backgroundImage: require('../../assets/images/spaceship.png'),
    backgroundImageStyle: 'spaceship',
    backgroundImageResizeMode: 'stretch',
  },
};

// Pickers (Add-wallet wizard + Wallet settings) render this list in order,
// so present the cards alphabetically by display name. Sorting here (rather
// than hand-ordering the map) keeps the map grouped logically while the UI
// stays A→Z as new cards are added.
export const themeList = Object.values(cardThemes).sort((a, b) => a.name.localeCompare(b.name));

/**
 * Card design a wallet falls back to when it carries no explicit (or a
 * stale/unknown) theme id: on-chain wallets default to the orange
 * **Bitcoin** card, Lightning/NWC wallets to the **Lightning Piggy** card.
 * These are the theme *ids* (`'bitcoin'` / `'lightning-piggy'`) — display
 * names may differ.
 */
export function defaultCardThemeFor(walletType: WalletType): CardTheme {
  return walletType === 'onchain' ? 'bitcoin' : 'lightning-piggy';
}
