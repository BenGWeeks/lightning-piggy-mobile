import { Store } from 'lucide-react-native';
import { btcMapIconComponent } from './btcMapIcon';

// Lock in the fallback contract: any unknown / null category resolves
// to Store so a future BTC Map glyph name we haven't mapped yet still
// renders a sensible icon (and the row layout doesn't collapse). This
// applies to both surfaces that consume the mapping — the React-side
// card / sheet rows, and the WebView's inline categorySvg() which
// mirrors the same fall-through.

describe('btcMapIconComponent', () => {
  it('returns the mapped Lucide component for a known category', () => {
    // Picking 'cafe' as a representative; the full mapping lives in
    // btcMapIcon.ts and is exercised end-to-end via the Places list.
    const Icon = btcMapIconComponent('cafe');
    // Not equal to Store — the fallback — so the mapping path is live.
    expect(Icon).not.toBe(Store);
  });

  it('falls back to Store for an unknown category', () => {
    // Simulates BTC Map introducing a brand-new glyph name we haven't
    // taught the app about yet. Must still resolve to a valid Lucide
    // component so render is stable.
    expect(btcMapIconComponent('uranium-mine')).toBe(Store);
  });

  it('falls back to Store for null', () => {
    expect(btcMapIconComponent(null)).toBe(Store);
  });

  it('falls back to Store for undefined', () => {
    expect(btcMapIconComponent(undefined)).toBe(Store);
  });

  it('falls back to Store for an empty string', () => {
    expect(btcMapIconComponent('')).toBe(Store);
  });
});
