/** Watch-only cards and their strip chips share the same muted gradient. */
export function walletCardGradientColors(
  colors: [string, string],
  watchOnly: boolean,
): [string, string] {
  if (!watchOnly) return colors;
  return colors.map((hex) => {
    const value = hex.replace('#', '');
    const grey = Math.round(
      0.299 * parseInt(value.slice(0, 2), 16) +
        0.587 * parseInt(value.slice(2, 4), 16) +
        0.114 * parseInt(value.slice(4, 6), 16),
    )
      .toString(16)
      .padStart(2, '0');
    return `#${grey}${grey}${grey}`;
  }) as [string, string];
}
