/**
 * Unit tests for the image-filter preset table (issue #138).
 *
 * Component-level tests for the picker sheet are covered by Maestro
 * (per jest.config.js — coverage scope is services/utils/contexts only).
 * These tests pin the preset shape, the bakeable contract, and the
 * passthrough guarantee of `applyFilterToImage` so a future
 * Skia/IFK swap can't silently regress the "Original is bytes-identical"
 * promise users rely on.
 */

import {
  ALL_FILTER_IDS,
  DEFAULT_FILTER_ID,
  FILTER_PRESETS,
  applyFilterToImage,
  getFilterPreset,
  isFilterBakeable,
  type FilterId,
} from './imageFilters';

describe('FILTER_PRESETS', () => {
  it('puts Original first so the picker opens on a no-op', () => {
    expect(FILTER_PRESETS[0]?.id).toBe('original');
    expect(DEFAULT_FILTER_ID).toBe('original');
  });

  it('ships at least the 6 acceptance-criteria presets (#138)', () => {
    // Issue #138 acceptance criteria: "At least 6 filters ship: Original,
    // Warm, Cool, Black & white, Retro, Pop." We deliver Original, B&W,
    // Sepia, Warm, Cool, Vintage, Pop — Vintage stands in for "Retro"
    // (same intent, the IFK preset name is `vintage`).
    expect(FILTER_PRESETS.length).toBeGreaterThanOrEqual(6);
    const ids = ALL_FILTER_IDS;
    expect(ids).toEqual(expect.arrayContaining(['original', 'bw', 'warm', 'cool', 'pop']));
  });

  it('has unique ids across the preset table', () => {
    const ids = FILTER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a non-empty label for every preset', () => {
    for (const preset of FILTER_PRESETS) {
      expect(typeof preset.label).toBe('string');
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });

  it('Original carries a null matrix (identity, no native wrap)', () => {
    const original = getFilterPreset('original');
    expect(original?.matrix).toBeNull();
  });

  it('non-Original presets carry a 20-entry color matrix', () => {
    for (const preset of FILTER_PRESETS) {
      if (preset.id === 'original') continue;
      expect(preset.matrix).not.toBeNull();
      expect(Array.isArray(preset.matrix)).toBe(true);
      // RN color-matrix is a 4x5 matrix flattened to 20 floats.
      expect(preset.matrix?.length).toBe(20);
    }
  });
});

describe('getFilterPreset', () => {
  it('returns the matching preset by id', () => {
    expect(getFilterPreset('bw')?.label).toBe('B&W');
  });

  it('returns undefined for an unknown id', () => {
    // Unknown ids can come from a stale persisted selection across an
    // app upgrade — callers must fall back to Original rather than crash.
    expect(getFilterPreset('not-a-real-filter' as FilterId)).toBeUndefined();
  });
});

describe('isFilterBakeable', () => {
  it('reports Original as bakeable (passthrough is trivially correct)', () => {
    expect(isFilterBakeable('original')).toBe(true);
  });

  it('reports every other filter as NOT bakeable today (#138 scaffold)', () => {
    // Today only Original actually changes the uploaded bytes — see the
    // file-level comment in imageFilters.ts. When the Skia/IFK follow-up
    // lands, this assertion flips and we add a regression test that
    // every preset is bakeable.
    for (const id of ALL_FILTER_IDS) {
      if (id === 'original') continue;
      expect(isFilterBakeable(id)).toBe(false);
    }
  });

  it('reports unknown ids as not bakeable', () => {
    expect(isFilterBakeable('does-not-exist' as FilterId)).toBe(false);
  });
});

describe('applyFilterToImage', () => {
  const URI = 'file:///tmp/picked.jpg';

  it('returns the original uri unchanged for Original', async () => {
    await expect(applyFilterToImage(URI, 'original')).resolves.toBe(URI);
  });

  it('returns the original uri unchanged for every preset (scaffold)', async () => {
    // Today every preset is a passthrough. This test exists so the
    // contract is explicit — when a real bake pipeline lands, this test
    // changes shape (e.g. to assert a NEW uri is returned for non-
    // Original filters) rather than being silently broken.
    for (const id of ALL_FILTER_IDS) {
      await expect(applyFilterToImage(URI, id)).resolves.toBe(URI);
    }
  });

  it('returns the original uri for an unknown id (graceful fallback)', async () => {
    await expect(applyFilterToImage(URI, 'mystery' as FilterId)).resolves.toBe(URI);
  });
});
