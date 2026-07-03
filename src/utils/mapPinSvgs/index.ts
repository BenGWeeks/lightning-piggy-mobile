// Lucide-derived SVG path strings for every glyph the Leaflet WebView
// needs to render inline. Each glyph lives in its own file under this
// folder; the file header points at the source lucide module so a
// future bump of `lucide-react-native` knows exactly what to re-copy.
//
// Why string-inlined: the Leaflet WebView is a sandboxed HTML island —
// React doesn't run there and `lucide-react-native` components can't
// reach it. The next-best thing is to hold the raw `<path d="…">`
// data and concatenate into divIcon HTML.
//
// Future improvement (task #18 / #27 follow-up): auto-generate these
// files from `lucide-static` at build time so a lucide update Just
// Works without manual copy-paste.

import { BEER_SVG } from './beer';
import { BIKE_SVG } from './bike';
import { BRIEFCASE_SVG } from './briefcase';
import { COFFEE_SVG } from './coffee';
import { FUEL_SVG } from './fuel';
import { HOTEL_SVG } from './hotel';
import { MAPPIN_SVG } from './mapPin';
import { PIGGY_SVG } from './piggy';
import { RESTAURANT_SVG } from './restaurant';
import { STORE_SVG } from './store';

// Used by the cache-pin renderer in ExploreMiniMap (not categories,
// but the same render machinery and same lucide-extracted shape).
export { PIGGY_SVG, MAPPIN_SVG };

// BTC Map category key → SVG inner content. Multiple keys can map to
// the same glyph (e.g. cafe + coffee both → COFFEE_SVG); BTC Map's
// curated list is small enough to enumerate explicitly. Keys mirror
// `ICON_MAP` in ../btcMapIcon.ts so the React (card/sheet/legend) and
// WebView (map pin) surfaces stay aligned.
const CATEGORY_SVGS: Record<string, string> = {
  // Generic merchant — most common BTC Map value.
  storefront: STORE_SVG,
  shop: STORE_SVG,
  shopping_bag: STORE_SVG,
  // Food + drink.
  cafe: COFFEE_SVG,
  coffee: COFFEE_SVG,
  restaurant: RESTAURANT_SVG,
  fast_food: RESTAURANT_SVG,
  pizza: RESTAURANT_SVG,
  bar: BEER_SVG,
  pub: BEER_SVG,
  // Lodging.
  hotel: HOTEL_SVG,
  lodging: HOTEL_SVG,
  bed: HOTEL_SVG,
  // Services.
  office: BRIEFCASE_SVG,
  fuel: FUEL_SVG,
  gas_station: FUEL_SVG,
  bicycle: BIKE_SVG,
  bike: BIKE_SVG,
};

/**
 * Resolve a BTC Map category key to its lucide-derived SVG path
 * content for inline rendering. Falls back to `STORE_SVG` when the
 * key is unknown / null / undefined / empty — keeps map pins stable
 * even if BTC Map ships a new glyph name we haven't taught the app
 * about yet. See `btcMapIcon.test.ts` for the parallel React-side
 * contract.
 */
export const categorySvg = (category: string | null | undefined): string => {
  if (!category) return STORE_SVG;
  return CATEGORY_SVGS[category] ?? STORE_SVG;
};

/**
 * Bridge string for the Leaflet WebView's JS context. The map's
 * `makeHtml` template literal interpolates this so the in-WebView
 * code can use `categorySvg('cafe')`, `PIGGY_SVG`, etc. as if they
 * were defined locally. Keeping the WebView-side declarations
 * generated from the same TS modules removes the previous
 * duplication where each glyph was hand-written twice (once as a
 * React-tree-only import in btcMapIcon.ts and once as an inline
 * string in ExploreMiniMap's HTML).
 */
export const MAP_PIN_SVG_PALETTE_JS = `
const PIGGY_SVG=${JSON.stringify(PIGGY_SVG)};
const MAPPIN_SVG=${JSON.stringify(MAPPIN_SVG)};
const STORE_SVG=${JSON.stringify(STORE_SVG)};
const CATEGORY_SVGS=${JSON.stringify(CATEGORY_SVGS)};
const categorySvg=(cat)=>(cat&&CATEGORY_SVGS[cat])||STORE_SVG;
`.trim();
