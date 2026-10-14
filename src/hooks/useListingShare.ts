import { useCallback, useMemo, useState } from 'react';
import { Share } from 'react-native';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { Toast } from '../components/BrandedToast';
import { sendSharedDm } from '../services/sendSharedDm';
import { listingNaddr, listingShareContent } from '../utils/listingShare';
import type { PickedFriend } from '../components/FriendPickerSheet';
import type { MarketProduct } from '../data/marketProducts';

/**
 * Share a kind-30402 Market listing (#1541): to a friend as a NIP-17 DM, or
 * through the OS share sheet. Both carry the title plus a `nostr:naddr1…`
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
      if (!content || !pubkey || sending) return;
      setSending(true);
      try {
        // NIP-17 explicitly: a listing share is an ordinary private message.
        const protocol = 'nip17' as const;
        const result = await sendSharedDm({
          peer: friend.pubkey,
          text: content.message,
          protocol,
          send: () => sendDirectMessage(friend.pubkey, content.message, { protocol }),
          append: appendLocalDmMessage,
        });
        Toast.show(
          result.success
            ? { type: 'success', text1: t('market.share.sentTo', { name: friend.name }) }
            : {
                type: 'error',
                text1: t('market.share.sendFailed'),
                text2: result.error,
              },
        );
      } finally {
        setSending(false);
      }
    },
    [content, pubkey, sending, sendDirectMessage, appendLocalDmMessage, t],
  );

  return { available: !!content, signedIn: !!pubkey, sending, shareLink, sendToFriend };
}
