import type { Event, EventTemplate } from 'nostr-tools';
import { queryQuorum, verifiedOwnEvents, publishSellerEvent } from './marketSellerService';
import {
  mergeMerchantProfile,
  type ProfilePatch,
  type ProfilePublishOptions,
} from '../utils/merchantProfile';
import {
  isNewerRevision,
  SellerFetchError,
  StaleRevisionError,
} from '../utils/marketSellerRevision';
import { DEFAULT_RELAYS, PROFILE_RELAYS } from './nostrRelayDefaults';
import { SellerSigningError, signSellerMutation } from '../utils/sellerSigning';

/** Bound user relay fan-out separately so indexers/defaults cannot be crowded out. */
export function profileReadRelays(relays: readonly string[]): string[] {
  return [
    ...new Set([
      ...relays.filter((url) => /^wss:\/\//.test(url)).slice(0, 32),
      ...PROFILE_RELAYS,
      ...DEFAULT_RELAYS,
    ]),
  ];
}

// Full verified events only; never reconstruct a kind 0 from display/cache fields.
const knownProfiles = new Map<string, Event>();
function rememberProfile(event: Event) {
  knownProfiles.delete(event.pubkey);
  knownProfiles.set(event.pubkey, event);
  if (knownProfiles.size > 64) knownProfiles.delete(knownProfiles.keys().next().value!);
}
export class ProfileUnavailableError extends SellerFetchError {}

export async function fetchMerchantProfile(
  pubkey: string,
  relays: string[],
  signal?: AbortSignal,
): Promise<Event | null> {
  const events = await queryQuorum(
    profileReadRelays(relays),
    { kinds: [0], authors: [pubkey], limit: 5 },
    signal,
  );
  const own = await verifiedOwnEvents(events, pubkey, [0], signal);
  const newest = own.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
  const known = knownProfiles.get(pubkey);
  if (!newest) {
    if (known) throw new ProfileUnavailableError('Profile unavailable');
    return null;
  }
  const latest = known && isNewerRevision(known, newest) ? known : newest;
  rememberProfile(latest);
  return latest;
}
export async function publishMergedProfile(input: {
  pubkey: string;
  relays: string[];
  patch: ProfilePatch;
  hasExistingProfile?: boolean;
  writeRelays?: string[];
  options?: ProfilePublishOptions;
  isCurrent: () => boolean;
  sign: (event: EventTemplate) => Promise<Event | null>;
}): Promise<Event> {
  const options = input.options ?? {};
  const verifiedBase = options.base
    ? (await verifiedOwnEvents([options.base], input.pubkey, [0]))[0]
    : undefined;
  let latest: Event | null;
  try {
    latest = await fetchMerchantProfile(input.pubkey, input.relays);
  } catch (e) {
    if (e instanceof ProfileUnavailableError) throw e;
    throw new SellerFetchError(e);
  }
  if (!latest && (verifiedBase || input.hasExistingProfile))
    throw new ProfileUnavailableError('Profile unavailable');
  if (verifiedBase && latest && isNewerRevision(verifiedBase, latest)) latest = verifiedBase;
  if ('base' in options && latest?.id !== options.base?.id && !options.force)
    throw new StaleRevisionError(latest, options.base ?? null);
  const template = mergeMerchantProfile(latest, input.patch, options.paymentPreference);
  const signed = await signSellerMutation({
    pubkey: input.pubkey,
    template,
    isCurrent: input.isCurrent,
    sign: input.sign,
  });
  let afterSigning: Event | null;
  try {
    afterSigning = await fetchMerchantProfile(input.pubkey, input.relays);
  } catch (e) {
    if (e instanceof ProfileUnavailableError) throw e;
    throw new SellerFetchError(e);
  }
  if (latest && !afterSigning) throw new ProfileUnavailableError('Profile unavailable');
  if (afterSigning && isNewerRevision(afterSigning, latest))
    throw new StaleRevisionError(afterSigning, latest);
  if (!input.isCurrent()) throw new SellerSigningError('Signing account changed');
  await publishSellerEvent(signed, input.writeRelays ?? input.relays);
  rememberProfile(signed);
  return signed;
}
