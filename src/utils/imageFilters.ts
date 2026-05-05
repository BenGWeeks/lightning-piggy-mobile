/**
 * Filter presets for the outgoing-image picker (issue #138).
 *
 * Each filter has:
 *   - `id`         — stable string used in tests + as a React key.
 *   - `label`      — short, kid-friendly display name shown under the
 *                    thumbnail in the picker carousel.
 *   - `matrix`     — color matrix factory from
 *                    `react-native-color-matrix-image-filters`. Used to
 *                    render the LIVE PREVIEW inside `ImageFilterSheet`.
 *                    `null` means "no transform" (Original).
 *   - `bakeable`   — whether the filter currently bakes into the
 *                    outgoing file. Today only `original` is bakeable —
 *                    the live-preview library composes a native View
 *                    around the Image at render time, but does NOT
 *                    write the filtered pixels back to disk (its README
 *                    explicitly defers that to react-native-image-filter-
 *                    kit / Skia / GL — none of which we want to pull in
 *                    yet, see follow-up below). Non-bakeable filters
 *                    show in the preview but pass the original bytes
 *                    through to Blossom.
 *
 * Follow-up: replace this scaffold with a real Skia or
 * react-native-image-filter-kit pipeline that captures the filtered
 * pixels into a fresh file URI before upload. Tracked separately from
 * #138 so the picker UX can ship and we can iterate on the preset list
 * without blocking on the native-module choice.
 */

// Import the matrix factories from `rn-color-matrices` directly rather
// than from the `react-native-color-matrix-image-filters` wrapper. Both
// re-export the same factory functions, but the wrapper also pulls in
// the native filter component (CMIFColorMatrixImageFilterNativeComponent),
// which trips React Native's codegen pass during Jest transformation
// and breaks unit tests that just want the matrix data. The wrapper IS
// imported by `ImageFilterSheet.tsx`, where the native component is
// actually needed.
import colorMatrices, { type Matrix } from 'rn-color-matrices';
const { grayscale, sepia, warm, cool, vintage, contrast } = colorMatrices;

export type FilterId = 'original' | 'bw' | 'sepia' | 'warm' | 'cool' | 'vintage' | 'pop';

export interface FilterPreset {
  readonly id: FilterId;
  readonly label: string;
  /** Color matrix used for the live preview. `null` = identity (Original). */
  readonly matrix: Matrix | null;
  /**
   * Whether the filter actually bakes into the uploaded file. Today only
   * `original` is true; other entries preview but pass through. See the
   * file-level docstring + the follow-up Skia/IFK issue.
   */
  readonly bakeable: boolean;
}

// Order matters: `Original` is always first so the picker opens on a
// known-good, no-op selection.
export const FILTER_PRESETS: readonly FilterPreset[] = [
  { id: 'original', label: 'Original', matrix: null, bakeable: true },
  { id: 'bw', label: 'B&W', matrix: grayscale(), bakeable: false },
  { id: 'sepia', label: 'Sepia', matrix: sepia(), bakeable: false },
  { id: 'warm', label: 'Warm', matrix: warm(), bakeable: false },
  { id: 'cool', label: 'Cool', matrix: cool(), bakeable: false },
  { id: 'vintage', label: 'Vintage', matrix: vintage(), bakeable: false },
  // "Pop" = high contrast. `contrast(1.4)` is the strongest of the
  // presets — anything > ~1.6 starts blowing out highlights on
  // already-bright camera shots.
  { id: 'pop', label: 'Pop', matrix: contrast(1.4), bakeable: false },
] as const;

export const DEFAULT_FILTER_ID: FilterId = 'original';

/**
 * Look up a preset by id. Returns `undefined` for unknown ids — callers
 * (sheet UI, send-path stub) should fall back to `original` rather than
 * blow up, since presets can be added/removed across builds.
 */
export function getFilterPreset(id: FilterId): FilterPreset | undefined {
  return FILTER_PRESETS.find((preset) => preset.id === id);
}

/**
 * Returns true iff applying the named filter to a picked image would
 * change the bytes that get uploaded. Used by the send-path stub to
 * decide whether to skip the (currently no-op) bake step entirely.
 *
 * NOTE: as of #138 this is `true` only for `original` (since "no-op" is
 * trivially correct). Once a real bake pipeline lands, every preset's
 * `bakeable` flag flips to `true` and this function effectively becomes
 * `id !== 'original'`.
 */
export function isFilterBakeable(id: FilterId): boolean {
  return getFilterPreset(id)?.bakeable ?? false;
}

/**
 * Apply a filter to a picked image, returning a (possibly new) local
 * file URI suitable for upload. Today this is a passthrough for every
 * preset — see the file-level docstring. Kept as an async function so
 * the call site doesn't need to change when a real bake pipeline lands.
 *
 * The `_unusedMatrix` parameter is intentionally unread: it would feed
 * a Skia/IFK pipeline once one is wired up. We accept it now so the
 * eventual switch is a one-file change.
 */
export async function applyFilterToImage(uri: string, filterId: FilterId): Promise<string> {
  const preset = getFilterPreset(filterId);
  if (!preset || !preset.matrix) {
    // Original or unknown — return original bytes verbatim.
    return uri;
  }
  // TODO(#138-followup): bake `preset.matrix` into the file via Skia /
  // react-native-image-filter-kit / view-shot. Until then, the live
  // preview shows the filter but the upload sends the original. The
  // sheet header surfaces this honestly via the "preview only" badge.
  return uri;
}

// Export the unused-symbol guard for tests so they can iterate the
// preset list without depending on its private ordering.
export const ALL_FILTER_IDS: readonly FilterId[] = FILTER_PRESETS.map((preset) => preset.id);
