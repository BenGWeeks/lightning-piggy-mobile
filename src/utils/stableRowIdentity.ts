import { useRef } from 'react';

/**
 * Identity-stabilises a derived list across rebuilds: rows that are
 * value-identical (same `id`, shallow-equal fields) come back as the
 * PREVIOUS object reference, and when every row is reused in the same
 * order the previous ARRAY reference is returned too.
 *
 * Why (#854): the Messages inbox derives its summary rows from `contacts`,
 * which churns on every profile batch while a cold-start `fetchProfiles`
 * is streaming. Each rebuild produced all-new row objects, so every
 * `React.memo`'d row (ConversationRow) saw a "new" summary prop and
 * re-rendered — the whole visible list, on every batch — racing
 * FlashList's cell recycling and leaving blank cells mid-scroll. Handing
 * back the previous object whenever the row is value-identical lets
 * React.memo actually bail out. (FlashList v2 sizes rows automatically —
 * `estimatedItemSize` no longer exists — so row-render cost is the
 * remaining lever for the blank-cell thrash.)
 *
 * Only safe for rows whose fields are primitives (compared with
 * `Object.is`); nested objects would need their own stabilisation.
 */
export function reuseByIdShallow<T extends { id: string }>(
  prev: readonly T[],
  next: readonly T[],
): readonly T[] {
  if (prev === next) return next;
  const prevById = new Map<string, T>();
  for (const p of prev) prevById.set(p.id, p);
  // Whether `next` is element-for-element the reused `prev` objects in the
  // same positions — only then can we return `prev` itself.
  let sameAsPrev = prev.length === next.length;
  const out: T[] = new Array<T>(next.length);
  for (let i = 0; i < next.length; i++) {
    const n = next[i];
    const p = prevById.get(n.id);
    if (p !== undefined && shallowEqual(p, n)) {
      out[i] = p;
      if (sameAsPrev && prev[i] !== p) sameAsPrev = false;
    } else {
      out[i] = n;
      sameAsPrev = false;
    }
  }
  return sameAsPrev ? prev : out;
}

function shallowEqual(a: object, b: object): boolean {
  const ak = Object.keys(a) as (keyof typeof a)[];
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    // Ownership check first: with equal key COUNTS but different key NAMES,
    // an own-key of `a` holding `undefined` would otherwise Object.is-match
    // `b`'s missing key (undefined) and false-positive as equal.
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!Object.is(a[k], (b as typeof a)[k])) return false;
  }
  return true;
}

/**
 * Hook wrapper around {@link reuseByIdShallow}: feeds each render's list
 * through the stabiliser against the previous render's OUTPUT, so row and
 * array identities survive upstream memo invalidations that didn't change
 * row values.
 */
export function useStableRowIdentity<T extends { id: string }>(list: readonly T[]): readonly T[] {
  const prevRef = useRef<readonly T[]>([]);
  const stable = reuseByIdShallow(prevRef.current, list);
  prevRef.current = stable;
  return stable;
}
