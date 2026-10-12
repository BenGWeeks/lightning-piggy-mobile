import type { Event, EventTemplate } from 'nostr-tools';
import { queryQuorum, verifiedOwnEvents, publishSellerEvent } from './marketSellerService';
import {
  mergeMerchantProfile,
  type ProfilePatch,
  type ProfilePublishOptions,
} from '../utils/merchantProfile';
import { SellerFetchError, StaleRevisionError } from '../utils/marketSellerRevision';
import { signSellerMutation } from '../utils/sellerSigning';

export async function fetchMerchantProfile(
  pubkey: string,
  relays: string[],
  signal?: AbortSignal,
): Promise<Event | null> {
  const events = await queryQuorum(relays, { kinds: [0], authors: [pubkey], limit: 5 }, signal);
  const own = await verifiedOwnEvents(events, pubkey, [0], signal);
  return own.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0] ?? null;
}
export async function publishMergedProfile(input: {
  pubkey: string;
  relays: string[];
  patch: ProfilePatch;
  options?: ProfilePublishOptions;
  isCurrent: () => boolean;
  sign: (event: EventTemplate) => Promise<Event | null>;
}): Promise<Event> {
  let latest: Event | null;
  try {
    latest = await fetchMerchantProfile(input.pubkey, input.relays);
  } catch (e) {
    throw new SellerFetchError(e);
  }
  const options = input.options ?? {};
  if ('base' in options && latest?.id !== options.base?.id && !options.force)
    throw new StaleRevisionError(latest, options.base ?? null);
  const template = mergeMerchantProfile(latest, input.patch, options.paymentPreference);
  const signed = await signSellerMutation({
    pubkey: input.pubkey,
    template,
    isCurrent: input.isCurrent,
    sign: input.sign,
  });
  await publishSellerEvent(signed, input.relays);
  return signed;
}
