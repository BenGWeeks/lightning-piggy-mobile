import type { Event } from 'nostr-tools';
import { COLLECTION_KIND, SHOP_COLLECTION_D, type EventTemplate } from './marketSellerEvents';

export interface CollectionDraft {
  dTag: string;
  title: string;
  summary: string;
  image: string;
  location: string;
  shipping: string[];
  products: string[];
}
const value = (event: Pick<Event, 'tags'>, key: string) =>
  event.tags.find((t) => t[0] === key)?.[1] ?? '';
const references = (event: Pick<Event, 'tags'>, key: string) =>
  event.tags.filter((t) => t[0] === key && t[1]).map((t) => t[1]);

export function parseCollection(event: Pick<Event, 'tags'>): CollectionDraft {
  return {
    dTag: value(event, 'd'),
    title: value(event, 'title'),
    summary: value(event, 'summary'),
    image: value(event, 'image'),
    location: value(event, 'location'),
    shipping: references(event, 'shipping_option'),
    products: references(event, 'a'),
  };
}

export function buildCollectionTemplate(
  draft: CollectionDraft,
  previous?: Event | null,
): EventTemplate {
  if (!draft.dTag || !draft.title.trim() || draft.title.length > 200)
    throw new Error('Invalid collection');
  if (draft.image && !/^https:\/\//.test(draft.image)) throw new Error('Invalid collection image');
  if (
    draft.products.some((c) => !/^30402:[0-9a-f]{64}:.+$/.test(c)) ||
    draft.shipping.some((c) => !/^30406:[0-9a-f]{64}:.+$/.test(c))
  )
    throw new Error('Invalid collection reference');
  const tags: string[][] = [
    ['d', draft.dTag],
    ['title', draft.title.trim()],
  ];
  for (const key of ['summary', 'image', 'location'] as const)
    if (draft[key].trim()) tags.push([key, draft[key].trim()]);
  for (const c of new Set(draft.products)) tags.push(['a', c]);
  for (const c of new Set(draft.shipping)) tags.push(['shipping_option', c]);
  const managed = new Set(['d', 'title', 'summary', 'image', 'location', 'a', 'shipping_option']);
  tags.push(...(previous?.tags ?? []).filter((t) => !managed.has(t[0])).map((t) => [...t]));
  return { kind: COLLECTION_KIND, content: previous?.content ?? '', tags };
}

/** Old builds uniquely used this d + currency extension for shop settings.
 * Do not offer migration for other clients' collections sharing only a title. */
export function isLegacyShopCollection(event: Event | null): boolean {
  return (
    !!event &&
    event.kind === COLLECTION_KIND &&
    value(event, 'd') === SHOP_COLLECTION_D &&
    !!value(event, 'currency')
  );
}
