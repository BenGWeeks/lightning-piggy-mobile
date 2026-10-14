import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Share } from 'react-native';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { Toast } from '../components/BrandedToast';
import { preferredDmProtocol } from '../services/preferredDmProtocol';
import { sendSharedDm } from '../services/sendSharedDm';
import { listingNaddr, listingShareContent } from '../utils/listingShare';
import type { PickedFriend } from '../components/FriendPickerSheet';
import type { MarketProduct } from '../data/marketProducts';

/**
 * Share a kind-30402 Market listing (#1541): to a friend as a private message
 * (Marmot when we already have a secure chat with them or they publish an
 * invitation key, otherwise NIP-17), or through the OS share sheet. Both carry the title plus a `nostr:naddr1…`
 * reference (see utils/listingShare for why there's no web link).
 * `content` is null for products that can't be shared this way.
 */
export function useListingShare(product: MarketProduct) {
  const t = useTranslation();
  const { pubkey, sendDirectMessage, appendLocalDmMessage } = useNostr();
  const event = product.listing?.event;
  const content = useMemo(() => {
    const naddr = event ? listingNaddr(event) : null;
    return naddr ? listingShareContent(product.title, naddr) : null;
  }, [event, product.title]);
  const [sending, setSending] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  const sendingRef = useRef(false);

  useLayoutEffect(() => {
    mounted.current = true;
    sendingRef.current = false;
    setSending(false);
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [pubkey]);

  const shareLink = useCallback(async () => {
    if (!content) return;
    try {
      await Share.share({ message: content.message });
    } catch {
      // Dismissed or rejected by the platform — nothing to surface.
    }
  }, [content]);

  const sendToFriend = useCallback(
    async (friend: PickedFriend) => {
      if (!content || !pubkey || !mounted.current || sendingRef.current) return;
      const ownerPubkey = pubkey;
      const ownerGeneration = generation.current;
      const isCurrent = () => mounted.current && generation.current === ownerGeneration;
      sendingRef.current = true;
      setSending(true);
      try {
        // Same choice as starting a chat: an existing Marmot 1:1 or a usable
        // invitation key means Marmot, otherwise NIP-17.
        const protocol = await preferredDmProtocol(ownerPubkey, friend.pubkey);
        if (!isCurrent()) return;
        const result = await sendSharedDm({
          peer: friend.pubkey,
          text: content.message,
          protocol,
          send: () => sendDirectMessage(friend.pubkey, content.message, { protocol }),
          append: async (peer, message) => {
            if (isCurrent()) await appendLocalDmMessage(peer, message);
          },
        });
        if (!isCurrent()) return;
        Toast.show(
          result.success
            ? { type: 'success', text1: t('market.share.sentTo', { name: friend.name }) }
            : {
                type: 'error',
                text1: t('market.share.sendFailed'),
                text2: result.error,
              },
        );
      } catch {
        if (isCurrent()) Toast.show({ type: 'error', text1: t('market.share.sendFailed') });
      } finally {
        if (isCurrent()) {
          sendingRef.current = false;
          setSending(false);
        }
      }
    },
    [content, pubkey, sendDirectMessage, appendLocalDmMessage, t],
  );

  return { available: !!content, signedIn: !!pubkey, sending, shareLink, sendToFriend };
}
