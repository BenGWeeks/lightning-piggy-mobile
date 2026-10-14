// Ordering helpers for a listing's photos (#1534). The displayed order is the
// order written to the kind-30402 `image` tags. The first photo is the cover,
// which is what Market grid cards show. PURE.

/** `images` with the photo at `from` moved to index `to`. Indices outside the
 * list leave it unchanged. */
export function movePhoto(images: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= images.length || to >= images.length) {
    return [...images];
  }
  const next = [...images];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Make the photo at `index` the cover (position 0). The others keep their order. */
export const setCoverPhoto = (images: readonly string[], index: number): string[] =>
  movePhoto(images, index, 0);
