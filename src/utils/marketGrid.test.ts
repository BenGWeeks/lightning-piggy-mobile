import {
  MARKET_GRID_COLUMNS,
  MARKET_GRID_GAP,
  MARKET_GRID_PADDING,
  marketGridTileWidth,
} from './marketGrid';

describe('marketGridTileWidth', () => {
  it('splits a phone width into two equal tiles minus padding and one gutter', () => {
    // 390 (iPhone-ish) - 2*16 padding = 358 usable; - 12 gutter = 346; / 2 = 173.
    expect(marketGridTileWidth(390)).toBe(173);
  });

  it('uses the module default columns/gap/padding when omitted', () => {
    const explicit = marketGridTileWidth(
      412,
      MARKET_GRID_COLUMNS,
      MARKET_GRID_GAP,
      MARKET_GRID_PADDING,
    );
    expect(marketGridTileWidth(412)).toBe(explicit);
  });

  it('two tiles plus the gutter never exceed the usable width (no overflow)', () => {
    for (const w of [320, 360, 390, 412, 480, 768]) {
      const tile = marketGridTileWidth(w);
      const usable = w - MARKET_GRID_PADDING * 2;
      expect(tile * 2 + MARKET_GRID_GAP).toBeLessThanOrEqual(usable);
    }
  });

  it('supports an arbitrary column count', () => {
    // 400 - 32 padding = 368; 3 cols => 2 gutters * 12 = 24; (368-24)/3 = 114.6 -> 114.
    expect(marketGridTileWidth(400, 3)).toBe(114);
  });

  it('floors to whole pixels to avoid sub-pixel seams', () => {
    const tile = marketGridTileWidth(375);
    expect(Number.isInteger(tile)).toBe(true);
  });

  it('clamps to a positive width for pathologically narrow windows', () => {
    expect(marketGridTileWidth(10)).toBeGreaterThanOrEqual(1);
    expect(marketGridTileWidth(0)).toBeGreaterThanOrEqual(1);
  });

  it('guards against a zero/negative column count', () => {
    expect(marketGridTileWidth(390, 0)).toBeGreaterThanOrEqual(1);
    expect(marketGridTileWidth(390, -2)).toBeGreaterThanOrEqual(1);
  });
});
