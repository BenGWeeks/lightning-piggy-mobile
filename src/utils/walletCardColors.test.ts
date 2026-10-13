import { walletCardGradientColors } from './walletCardColors';

it('keeps spendable gradients and matches the watch-only card greys', () => {
  const colors: [string, string] = ['#FF0000', '#00FF00'];
  expect(walletCardGradientColors(colors, false)).toBe(colors);
  expect(walletCardGradientColors(colors, true)).toEqual(['#4c4c4c', '#969696']);
  expect(colors).toEqual(['#FF0000', '#00FF00']);
});
