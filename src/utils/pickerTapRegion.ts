/** Layout dimensions shared with the picker; all returned coordinates are local to its item. */
export interface PickerGeometry {
  viewportWidth: number;
  cardWidth: number;
  interval: number;
}

export const PICKER_SCALES = [1, 0.82, 0.66, 0.54, 0.46];
export const PICKER_OFFSETS = [0, 0.42, 0.72, 0.98, 1.2];

// Only the exposed part of a fanned card is interactive. A full-card touch
// target would put its centre behind the card in front, including for Maestro.
export function pickerTapRegion(
  index: number,
  centredIndex: number,
  { viewportWidth, cardWidth, interval }: PickerGeometry,
) {
  const cardOverhang = (cardWidth - interval) / 2;
  const delta = index - centredIndex;
  const distance = Math.abs(delta);
  if (distance > 2) return { left: 0, width: 0 };
  if (distance === 0) return { left: -cardOverhang, width: cardWidth };
  const direction = Math.sign(delta);
  const scale = PICKER_SCALES[distance];
  const centre = direction * PICKER_OFFSETS[distance] * cardWidth;
  const innerCentre = direction * PICKER_OFFSETS[distance - 1] * cardWidth;
  const halfWidth = (scale * cardWidth) / 2;
  const innerHalfWidth = (PICKER_SCALES[distance - 1] * cardWidth) / 2;
  const left = Math.max(
    centre - halfWidth,
    -viewportWidth / 2,
    direction > 0 ? innerCentre + innerHalfWidth : -Infinity,
  );
  const right = Math.min(
    centre + halfWidth,
    viewportWidth / 2,
    direction < 0 ? innerCentre - innerHalfWidth : Infinity,
  );
  return {
    left: interval / 2 + (left - centre) / scale,
    width: Math.max(0, (right - left) / scale),
  };
}
