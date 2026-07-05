import { useCallback, useState } from 'react';
import { Alert } from '../components/BrandedAlert';
import Toast from '../components/BrandedToast';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { getNwcUrl } from '../services/walletStorageService';
import { nwcShareCardFromWallet } from '../utils/nwcShareMessage';
import type { PickedFriend } from '../components/FriendPickerSheet';
import type { WalletState } from '../types/wallet';

/**
 * "Share this wallet" flow from Wallet Settings (#431 follow-up). The
 * conversation Attach (+) menu already shares an NWC wallet into an *open*
 * thread (see `useNwcShareActions`); this hook is the settings entry point,
 * where there is no active conversation — so it adds a recipient step
 * (`FriendPickerSheet`) between the trust warning and the send.
 *
 * It deliberately REUSES #988's machinery rather than re-implementing it:
 * - the send/serialisation/redaction is the context's `sendNwcShare` (the same
 *   gift-wrapped NIP-17 rumor the Attach path publishes — the raw
 *   `nostr+walletconnect://…` secret only ever travels inside that encrypted
 *   wrap, never as on-screen text);
 * - the wallet name is derived by the shared `nwcShareCardFromWallet` helper so
 *   both entry points build an identical card.
 *
 * Order mirrors the task: tap Share → trust warning → pick a recipient → send.
 * The secret is read from SecureStore and sent only AFTER the user confirms the
 * warning and picks a trusted contact.
 */
export function useWalletShareFromSettings(wallet: WalletState | undefined) {
  const t = useTranslation();
  const { sendNwcShare } = useNostr();
  const [pickerOpen, setPickerOpen] = useState(false);

  const isNwc = wallet?.walletType === 'nwc';

  // Step 1: tap "Share this wallet" → trust warning. No recipient is chosen yet,
  // so the copy is the name-free variant of the Attach-menu warning.
  const startShare = useCallback(() => {
    if (!wallet || wallet.walletType !== 'nwc') return;
    Alert.alert(t('nwcShareSheet.confirmTitle'), t('nwcShareSheet.confirmBodyNoName'), [
      { text: t('nwcShareSheet.cancel'), style: 'cancel' },
      {
        text: t('nwcShareSheet.confirmShare'),
        style: 'destructive',
        onPress: () => setPickerOpen(true),
      },
    ]);
  }, [wallet, t]);

  const closePicker = useCallback(() => setPickerOpen(false), []);

  // Step 2: recipient picked → read the connection secret and send the same
  // gift-wrapped NWC-share DM the Attach path sends.
  const shareToFriend = useCallback(
    (friend: PickedFriend) => {
      setPickerOpen(false);
      if (!wallet || wallet.walletType !== 'nwc') return;
      void (async () => {
        let nwcUrl: string | null;
        try {
          nwcUrl = await getNwcUrl(wallet.id);
        } catch {
          // SecureStore reads can reject — treat a read failure the same as a
          // missing URL so it surfaces the "couldn't read the connection" alert
          // instead of becoming an unhandled rejection.
          nwcUrl = null;
        }
        if (!nwcUrl) {
          Alert.alert(t('nwcShareSheet.missingUrlTitle'), t('nwcShareSheet.missingUrl'));
          return;
        }
        const card = nwcShareCardFromWallet(nwcUrl, wallet.alias, wallet.walletAlias ?? undefined);
        const result = await sendNwcShare(friend.pubkey, card);
        if (result.success) {
          Toast.show({ type: 'success', text1: t('nwcShareSheet.sentToast') });
        } else {
          Alert.alert(
            t('nwcShareSheet.missingUrlTitle'),
            result.error ?? t('nwcShareCard.addFailedBody'),
          );
        }
      })();
    },
    [wallet, sendNwcShare, t],
  );

  return { isNwc, pickerOpen, startShare, closePicker, shareToFriend };
}
