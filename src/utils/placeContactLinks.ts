import type { BtcMapPlace } from '../services/btcMapService';

const firstValue = (...values: (string | null | undefined)[]): string | null =>
  values.map((value) => value?.trim()).find((value) => !!value) ?? null;

/** Both curated BTC Map fields and the two OSM contact conventions are valid. */
export function placeContactLinks(place: BtcMapPlace) {
  const phone = firstValue(place.phone, place.tags['contact:phone'], place.tags.phone);
  const website = firstValue(place.tags['contact:website'], place.tags.website);
  // OSM also permits bare domains. Restrict website actions to web schemes.
  const href = website
    ? /^[a-z][a-z\d+.-]*:/i.test(website)
      ? website
      : `https://${website}`
    : null;
  return {
    phone: phone ? { value: phone, href: `tel:${phone}` } : null,
    website: website && href && /^https?:\/\//i.test(href) ? { value: website, href } : null,
  };
}
