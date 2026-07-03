import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ContactProfileBodyData } from '../components/ContactProfileBody';
import type { ExploreNavigation, RootStackParamList } from '../navigation/types';
import * as nostrService from '../services/nostrService';
import { useNostr } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import { shortNpub } from '../utils/shortNpub';

/**
 * Owns the hider / finder contact bottom-sheet that `HuntPiggyDetailScreen`
 * opens when a hider attribution row or a find-log row is tapped.
 *
 * Lifted out of the screen so the wiring reads as one unit and the screen
 * stays under its size cap (#751). The behaviour mirrors the
 * `ConversationScreen` / `GroupConversationScreen` usage of
 * `ContactProfileSheet`, which the Hunt screen had drifted from:
 *
 *   1. **Banner + Lightning address** — `openProfileSheet` re-resolves the
 *      *verified* kind-0 profile (`nostrService.fetchProfile`) so the sheet
 *      gets a real `banner` and a real `lud16`. The avatar rows that drive
 *      the sheet read `usePubkeyProfile`, whose slim cache path drops the
 *      banner and can null the Lightning address (#554) — relying on it
 *      left the banner blank and the zap button greyed. We seed the sheet
 *      with whatever the row already knows for an instant paint, then patch
 *      in the verified fields when the fetch lands.
 *   2. **`canZap`** — the reference passes a real `canZap`; the Hunt screen
 *      passed none, so it defaulted `false` and the zap button rendered
 *      disabled even for contacts with a Lightning address. We gate it on a
 *      resolved Lightning address.
 *   3. **View full profile** — the reference wires `onViewFullProfile` to
 *      the `ContactProfile` route; the Hunt screen omitted it, so the
 *      "View full profile" affordance never rendered.
 *
 * The actual zap stays in the host screen's in-app NIP-57 SendSheet flow —
 * the hook just calls back `onRequestZap` with the resolved address so the
 * Hunt screen owns one zap surface (its find-log SendSheet).
 */

type HuntProfileNavigation = CompositeNavigationProp<
  ExploreNavigation,
  NativeStackNavigationProp<RootStackParamList>
>;

interface ProfileSheetState {
  pubkey: string;
  name: string;
  picture: string | null;
  banner: string | null;
  /** kind-0 `about` bio, patched in by the verified fetch. */
  about: string | null;
  lightningAddress: string | null;
}

export interface UseContactProfileSheet {
  /** Non-null while the sheet is presented. Drives `<ContactProfileSheet>`. */
  profileSheet: ProfileSheetState | null;
  /** The `ContactProfileBodyData` to pass to `<ContactProfileSheet contact>`. */
  contact: ContactProfileBodyData | null;
  /** True when the resolved contact has a Lightning address. */
  canZap: boolean;
  /** Open the sheet for a pubkey, seeding from the row's known fields and
   * patching in the verified banner + Lightning address asynchronously. */
  openProfileSheet: (
    pubkey: string,
    name: string | null,
    picture: string | null,
    lud16: string | null,
  ) => void;
  closeProfileSheet: () => void;
  /** Closes the sheet and opens a Conversation with the contact. */
  onMessage: (() => void) | undefined;
  /** Closes the sheet and asks the host to open its zap SendSheet. */
  onZap: (() => void) | undefined;
  /** Closes the sheet and drills into the full ContactProfile route. */
  onViewFullProfile: () => void;
}

export function useContactProfileSheet(
  navigation: HuntProfileNavigation,
  onRequestZap: (target: { pubkey: string; name: string; lud16: string }) => void,
): UseContactProfileSheet {
  const { relays } = useNostr();
  // A zap needs a wallet to actually pay — gate `canZap`/`onZap` on it so the
  // sheet never opens the in-app SendSheet (which assumes a non-null walletId)
  // with no wallet configured (#770 [blocking]).
  const { hasWallets } = useWallet();
  const [profileSheet, setProfileSheet] = useState<ProfileSheetState | null>(null);
  // Latest read-relay URLs held in a ref so `openProfileSheet` stays
  // referentially stable across `relays` array-identity churn (see its deps).
  const readRelaysRef = useRef<string[]>([]);
  readRelaysRef.current = useMemo(() => relays.filter((r) => r.read).map((r) => r.url), [relays]);
  // Guards the async verified-profile patch against a setState after the host
  // screen unmounts mid-fetch (#770).
  const isMountedRef = useRef(true);
  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const openProfileSheet = useCallback(
    (pubkey: string, name: string | null, picture: string | null, lud16: string | null) => {
      const display = name ?? shortNpub(pubkey);
      // Seed immediately so the sheet paints without waiting on a relay.
      setProfileSheet({
        pubkey,
        name: display,
        picture,
        banner: null,
        about: null,
        lightningAddress: lud16,
      });
      // Re-resolve the verified profile so the banner, bio and Lightning
      // address are real (the row's `usePubkeyProfile` slim path drops them).
      // Verified because `lud16` feeds a payment destination — never trust the
      // slim batch value for a zap.
      nostrService
        .fetchProfile(pubkey, readRelaysRef.current)
        .then((profile) => {
          if (!profile || !isMountedRef.current) return;
          setProfileSheet((prev) => {
            // The user may have closed the sheet or opened a different
            // contact while the fetch was in flight — only patch if this is
            // still the same contact.
            if (!prev || prev.pubkey !== pubkey) return prev;
            return {
              ...prev,
              name: profile.displayName ?? profile.name ?? prev.name,
              picture: profile.picture ?? prev.picture,
              banner: profile.banner ?? null,
              about: profile.about ?? null,
              // The verified fetch is AUTHORITATIVE for the payment address:
              // do NOT fall back to the seeded value, so a profile that has
              // cleared/removed its `lud16` correctly disables the zap rather
              // than letting a stale cached address mis-target funds (#770
              // review). `canZap`/`onZap` follow from this null.
              lightningAddress: profile.lud16 ?? null,
            };
          });
        })
        .catch(() => {});
    },
    // Stable across `relays` array-identity churn (NostrContext re-emits fresh
    // `relays` arrays on relay-list updates) — the read-relay set is read from
    // a ref, so rows holding `openProfileSheet` don't re-render needlessly.
    [],
  );

  const closeProfileSheet = useCallback(() => setProfileSheet(null), []);

  const contact = useMemo<ContactProfileBodyData | null>(
    () =>
      profileSheet
        ? {
            pubkey: profileSheet.pubkey,
            name: profileSheet.name,
            picture: profileSheet.picture,
            banner: profileSheet.banner,
            about: profileSheet.about,
            lightningAddress: profileSheet.lightningAddress,
            source: 'nostr',
          }
        : null,
    [profileSheet],
  );

  const canZap = hasWallets && Boolean(profileSheet?.lightningAddress);

  const onMessage = useMemo(
    () =>
      profileSheet
        ? () => {
            const target = profileSheet;
            setProfileSheet(null);
            navigation.navigate('Conversation', {
              pubkey: target.pubkey,
              name: target.name,
              picture: target.picture,
              lightningAddress: target.lightningAddress,
            });
          }
        : undefined,
    [profileSheet, navigation],
  );

  const onZap = useMemo(
    () =>
      hasWallets && profileSheet?.lightningAddress
        ? () => {
            const target = profileSheet;
            setProfileSheet(null);
            onRequestZap({
              pubkey: target.pubkey,
              name: target.name,
              lud16: target.lightningAddress!,
            });
          }
        : undefined,
    [hasWallets, profileSheet, onRequestZap],
  );

  const onViewFullProfile = useCallback(() => {
    if (!contact) return;
    setProfileSheet(null);
    navigation.navigate('ContactProfile', { contact });
  }, [contact, navigation]);

  return {
    profileSheet,
    contact,
    canZap,
    openProfileSheet,
    closeProfileSheet,
    onMessage,
    onZap,
    onViewFullProfile,
  };
}
