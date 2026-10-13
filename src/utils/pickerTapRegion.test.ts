import { pickerTapRegion, type PickerGeometry } from './pickerTapRegion';

const geometry: PickerGeometry = { viewportWidth: 1000, cardWidth: 480, interval: 201.6 };

// Project the local hit target through the rendered card's scale and translation.
// Assert its visible bounds, rather than duplicating the clipping calculation.
function visibleBounds(index: number, scale: number, centre: number, layout = geometry) {
  const region = pickerTapRegion(index, 5, layout);
  const left = centre + (region.left - layout.interval / 2) * scale;
  return { left, right: left + region.width * scale, width: region.width };
}

describe('pickerTapRegion', () => {
  it('covers the entire centred card, including its overhang beyond the item', () => {
    expect(pickerTapRegion(5, 5, geometry)).toEqual({ left: -139.2, width: 480 });
    const bounds = visibleBounds(5, 1, 0);
    expect(bounds.left).toBeCloseTo(-240);
    expect(bounds.right).toBeCloseTo(240);
  });

  it.each([
    [4, -201.6, -398.4, -240],
    [6, 201.6, 240, 398.4],
  ])('makes neighbour %i tappable only outside the centre card', (index, centre, left, right) => {
    const bounds = visibleBounds(index, 0.82, centre);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.left).toBeCloseTo(left);
    expect(bounds.right).toBeCloseTo(right);
  });

  it.each([
    [3, -345.6, -500, -398.4],
    [7, 345.6, 398.4, 500],
  ])(
    'clips outer neighbour %i to the viewport and avoids the nearer card',
    (index, centre, left, right) => {
      const bounds = visibleBounds(index, 0.66, centre);
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.left).toBeCloseTo(left);
      expect(bounds.right).toBeCloseTo(right);
    },
  );

  it.each([3, 7])('disables outer neighbour %i when its exposed area is offscreen', (index) => {
    expect(pickerTapRegion(index, 5, { ...geometry, viewportWidth: 700 }).width).toBe(0);
  });

  it.each([0, 1, 2, 8, 9, 10])('disables distant card %i on either side', (index) => {
    expect(pickerTapRegion(index, 5, geometry)).toEqual({ left: 0, width: 0 });
  });
});
