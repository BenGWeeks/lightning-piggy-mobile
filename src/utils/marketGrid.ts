/**
 * Pure layout maths for the Market screen's product GRID.
 *
 * The grid renders roughly-square product tiles in a fixed number of columns.
 * Tile width is derived from the live window width (so rotation / tablet
 * widths stay correct) rather than relying on flex — which also guarantees a
 * lone last tile in an odd-length list keeps its column width instead of
 * stretching to fill the row.
 */

/** Number of product columns on the Market grid (phone). */
export const MARKET_GRID_COLUMNS = 2;
/** Gutter (dp) between columns and rows. */
export const MARKET_GRID_GAP = 12;
/** Horizontal padding (dp) either side of the grid. */
export const MARKET_GRID_PADDING = 16;

/**
 * Width (dp) of a single product tile so that `columns` tiles plus the gutters
 * between them exactly fill the window inside the outer padding.
 *
 *   usable = windowWidth - 2 * padding
 *   tile   = (usable - gap * (columns - 1)) / columns
 *
 * Clamped to a sane minimum so a pathologically narrow window never yields a
 * zero/negative width. Floored to whole pixels to avoid sub-pixel seams.
 */
export const marketGridTileWidth = (
  windowWidth: number,
  columns: number = MARKET_GRID_COLUMNS,
  gap: number = MARKET_GRID_GAP,
  padding: number = MARKET_GRID_PADDING,
): number => {
  const safeColumns = Math.max(1, Math.floor(columns));
  const usable = windowWidth - padding * 2;
  const totalGap = gap * (safeColumns - 1);
  const tile = (usable - totalGap) / safeColumns;
  return Math.max(1, Math.floor(tile));
};
