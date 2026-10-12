import { createAccountDrawerContentStyles } from './AccountDrawerContent.styles';
import { darkPalette, lightPalette } from './palettes';

describe.each([lightPalette, darkPalette])('compact account drawer (#1375)', (palette) => {
  it('reduces row padding while preserving a minimum 48dp tap target', () => {
    const { row } = createAccountDrawerContentStyles(palette);
    expect(row.paddingVertical).toBeLessThan(14);
    expect(row.minHeight).toBeGreaterThanOrEqual(48);
    // Allow rows to grow for larger accessibility text sizes.
    expect(row).not.toHaveProperty('height');
  });
});
