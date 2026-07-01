// Pure logic for Market PRODUCT REVIEWS (Nostr kind 31555 — Gamma Markets
// review), ported from the Lightning Piggy companion website
// (RobotechyShop/robotechy-website, src/lib/productReviews.ts) so the mobile
// app scores products the same way.
//
// A review is an ADDRESSABLE event whose own `d` tag IS the product
// coordinate `a:30402:<merchant>:<dTag>` — so each reviewer's review of a
// given product is replaceable (re-publish with the same `d` = an edit).
// Ratings are stored on a 0..1 scale in the tag (4 of 5 stars -> 0.8); the UI
// works in 1..5 stars and converts only at the boundary.
//
// No React, no I/O — unit-testable in isolation (coverage scope: src/utils).
import type { Event as NostrEvent } from 'nostr-tools';

/** Gamma Markets product-review event kind. */
export const REVIEW_KIND = 31555;
/** NIP-99 classified-listing (product) event kind. */
export const PRODUCT_KIND = 30402;
/** Star scale used in the UI (ratings are stored 0..1). */
export const STARS_MAX = 5;

/** A per-category star rating (e.g. quality / delivery), 0..STARS_MAX. */
export interface CategoryStars {
  category: string;
  stars: number;
}

/** A parsed, usable review. */
export interface ParsedReview {
  id: string;
  pubkey: string;
  /** Overall rating on the 0..1 scale (as stored). */
  rating: number;
  /** Overall rating expressed in stars (0..STARS_MAX). */
  stars: number;
  categories: CategoryStars[];
  text: string;
  createdAt: number;
}

/** Aggregate over a set of reviews. */
export interface ReviewAggregate {
  /** Mean star value (0..STARS_MAX), 0 when there are no reviews. */
  average: number;
  count: number;
}

/** Input for {@link buildReviewEvent}. */
export interface BuildReviewInput {
  /** The product coordinate `a:30402:<merchant>:<dTag>`. */
  coord: string;
  /** Overall rating in stars (1..STARS_MAX). */
  stars: number;
  content?: string;
  categories?: CategoryStars[];
}

/** An unsigned review event template (kind + content + tags). */
export interface ReviewEventTemplate {
  kind: number;
  content: string;
  tags: string[][];
}

/** Build the product coordinate a review is keyed on (WITH the `a:` prefix). */
export function productReviewCoord(merchantPubkey: string, productDTag: string): string {
  return `a:${PRODUCT_KIND}:${merchantPubkey}:${productDTag}`;
}

/** Whether a string is a well-formed product-review coordinate. */
export function isProductReviewCoord(value: string): boolean {
  const parts = value.split(':');
  return (
    parts.length >= 4 &&
    parts[0] === 'a' &&
    parts[1] === String(PRODUCT_KIND) &&
    /^[0-9a-f]{64}$/i.test(parts[2]) &&
    parts.slice(3).join(':').length > 0 // the dTag may itself contain colons
  );
}

/** Stars (0..STARS_MAX) -> stored rating (0..1). Clamps + guards NaN. */
export function starsToRating(stars: number): number {
  if (!Number.isFinite(stars)) return 0;
  const clamped = Math.max(0, Math.min(STARS_MAX, stars));
  return clamped / STARS_MAX;
}

/** Stored rating (0..1) -> stars (0..STARS_MAX). Clamps + guards NaN. */
export function ratingToStars(rating: number): number {
  if (!Number.isFinite(rating)) return 0;
  const clamped = Math.max(0, Math.min(1, rating));
  return clamped * STARS_MAX;
}

// Trim float noise (0.30000000000000004 -> "0.3") while staying in 0..1.
function formatRating(rating: number): string {
  return parseFloat(Math.max(0, Math.min(1, rating)).toFixed(4)).toString();
}

/** Build the unsigned review event template for publishing. */
export function buildReviewEvent(input: BuildReviewInput): ReviewEventTemplate {
  const tags: string[][] = [
    ['d', input.coord],
    ['rating', formatRating(starsToRating(input.stars)), 'thumb'],
  ];
  for (const cr of input.categories ?? []) {
    if (!cr.category || cr.category === 'thumb' || cr.stars <= 0) continue;
    tags.push(['rating', formatRating(starsToRating(cr.stars)), cr.category]);
  }
  return { kind: REVIEW_KIND, content: input.content?.trim() ?? '', tags };
}

/** Parse a single event into a usable review, or `null` to skip it. */
export function parseReviewEvent(event: NostrEvent): ParsedReview | null {
  if (!event || event.kind !== REVIEW_KIND) return null;

  const dTag = event.tags.find((t) => t[0] === 'd');
  if (!dTag || typeof dTag[1] !== 'string' || !isProductReviewCoord(dTag[1])) return null;

  const ratingTags = event.tags.filter((t) => t[0] === 'rating' && typeof t[1] === 'string');
  const thumbTag = ratingTags.find((t) => t[2] === 'thumb');
  if (!thumbTag) return null; // no overall rating -> unusable

  const parsedThumb = parseFloat(thumbTag[1]);
  if (!Number.isFinite(parsedThumb)) return null; // non-numeric -> skip (don't count as 0)
  const rating = Math.max(0, Math.min(1, parsedThumb));

  const categories: CategoryStars[] = ratingTags
    .filter((t) => t[2] && t[2] !== 'thumb')
    .map((t) => ({ category: t[2], parsed: parseFloat(t[1]) }))
    .filter((c) => Number.isFinite(c.parsed)) // drop malformed, don't coerce to 0
    .map((c) => ({
      category: c.category,
      stars: ratingToStars(Math.max(0, Math.min(1, c.parsed))),
    }));

  return {
    id: event.id,
    pubkey: event.pubkey,
    rating,
    stars: ratingToStars(rating),
    categories,
    text: event.content ?? '',
    createdAt: event.created_at ?? 0,
  };
}

/** Keep the newest event per author (reviews are per-author replaceable). */
export function dedupeNewestPerAuthor(events: NostrEvent[]): NostrEvent[] {
  const byAuthor = new Map<string, NostrEvent>();
  for (const e of events) {
    const existing = byAuthor.get(e.pubkey);
    if (!existing || (e.created_at ?? 0) > (existing.created_at ?? 0)) {
      byAuthor.set(e.pubkey, e);
    }
  }
  return [...byAuthor.values()];
}

/**
 * Parse events into usable reviews, then keep the newest *parseable* review per
 * author, sorted newest-first.
 *
 * De-duping happens AFTER parsing (not before): if we de-duped raw events first,
 * a reviewer's newer-but-malformed kind-31555 (e.g. missing/invalid thumb) would
 * win, then get dropped by {@link parseReviewEvent}, silently hiding that
 * author's last *valid* review and skewing the aggregate. Parsing first means a
 * malformed newer event is discarded and the author's newest VALID review still
 * counts. Authors are keyed case-insensitively (pubkeys are hex) so a
 * differently-cased duplicate can't double-count.
 */
export function parseReviews(events: NostrEvent[]): ParsedReview[] {
  const newestPerAuthor = new Map<string, ParsedReview>();
  for (const event of events) {
    const review = parseReviewEvent(event);
    if (!review) continue;
    const key = review.pubkey.toLowerCase();
    const existing = newestPerAuthor.get(key);
    if (!existing || review.createdAt > existing.createdAt) {
      newestPerAuthor.set(key, review);
    }
  }
  return [...newestPerAuthor.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** Mean star value across reviews (0 when empty). Dedupe BEFORE calling. */
export function aggregateReviews(reviews: ParsedReview[]): ReviewAggregate {
  if (reviews.length === 0) return { average: 0, count: 0 };
  const sum = reviews.reduce((acc, r) => acc + r.stars, 0);
  return { average: sum / reviews.length, count: reviews.length };
}
