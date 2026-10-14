// Shipping gate for selling (#1534). A physical Gamma listing must name at
// least one shipping option, so the seller can't list one before the shop
// has any. PURE: the hub / Listings screen and the listing editor share it.
//
// Only a COMPLETED relay fetch proves "no shipping options". When the fetch
// failed (or hasn't finished) and nothing is cached, the answer is unknown,
// not "none". The caller then shows the usual error / retry instead of the
// shipping prompt.

export type SellerFetchStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ListingFormat = 'physical' | 'digital';

/** `open` = go ahead · `needs-shipping` = prompt to add shipping options ·
 * `unknown` = the shop couldn't be loaded, so offer a retry. */
export type SellGate = 'open' | 'needs-shipping' | 'unknown';

export function sellGate(input: {
  zoneCount: number;
  status: SellerFetchStatus;
  format?: ListingFormat;
}): SellGate {
  if (input.format === 'digital' || input.zoneCount > 0) return 'open';
  return input.status === 'ready' ? 'needs-shipping' : 'unknown';
}
