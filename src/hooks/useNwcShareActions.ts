import { useCallback, useMemo, useState } from 'react';
import { Alert } from '../components/BrandedAlert';
import Toast from '../components/BrandedToast';
import { useTranslation } from '../contexts/LocaleContext';
import * as walletStorage from '../services/walletStorageService';
import { validateNwcUrl } from '../services/nwcService';
import type { WalletState } from '../types/wallet';
import type { NwcShareCard } from '../utils/nwcShareMessage';

interface Params {
  /** All wallets; the hook filters to the shareable NWC ones. */
  wallets: WalletState[];
  /** WalletContext's NWC import — validates by connecting, then stores. */
  addNwcWallet: (
    nwcUrl: string,
    alias: string,
    theme: 'lightning-piggy',
  ) => Promise<{ success: boolean; error?: string; walletId?: string }>;
  /** Composer action that gift-wraps the share into the encrypted NIP-17 DM. */
  shareNwcWallet: (card: NwcShareCard) => Promise<boolean>;
  /** The peer's display name — used in the warning copy. */
  peerName: string;
  /** Close the attach panel once a share flow starts/completes. */
  onCloseAttachPanel: () => void;
}

/**
 * Sender + recipient "share an NWC wallet" flows (#431), lifted out of
 * ConversationScreen to keep it under the size cap. The NWC connection string is
 * a bearer secret, so both directions are gated behind an explicit access
 * warning before the string is ever sent (sender) or imported (recipient); it
 * only ever travels inside the encrypted NIP-17 DM.
 */
export function useNwcShareActions({
  wallets,
  addNwcWallet,
  shareNwcWallet,
  peerName,
  onCloseAttachPanel,
}: Params) {
  const t = useTranslation();
  const [nwcPickerOpen, setNwcPickerOpen] = useState(false);

  const nwcWallets = useMemo(() => wallets.filter((w) => w.walletType === 'nwc'), [wallets]);

  // Attach → Share Wallet. No NWC wallet ⇒ explain rather than open an empty
  // picker; otherwise present the picker over the conversation.
  const openNwcSharePicker = useCallback(() => {
    if (nwcWallets.length === 0) {
      Alert.alert(t('nwcShareSheet.noneTitle'), t('nwcShareSheet.noneBody'));
      return;
    }
    setNwcPickerOpen(true);
  }, [nwcWallets.length, t]);

  const closeNwcPicker = useCallback(() => {
    setNwcPickerOpen(false);
    onCloseAttachPanel();
  }, [onCloseAttachPanel]);

  // Sender picked a wallet → warn about granting access, then gift-wrap + send.
  const shareToWallet = useCallback(
    (walletId: string) => {
      setNwcPickerOpen(false);
      onCloseAttachPanel();
      const wallet = nwcWallets.find((w) => w.id === walletId);
      if (!wallet) return;
      Alert.alert(
        t('nwcShareSheet.confirmTitle'),
        t('nwcShareSheet.confirmBody', { wallet: wallet.alias, name: peerName }),
        [
          { text: t('nwcShareSheet.cancel'), style: 'cancel' },
          {
            text: t('nwcShareSheet.confirmShare'),
            style: 'destructive',
            onPress: () => {
              void (async () => {
                const nwcUrl = await walletStorage.getNwcUrl(walletId);
                if (!nwcUrl) {
                  Alert.alert(t('nwcShareSheet.noneTitle'), t('nwcShareSheet.missingUrl'));
                  return;
                }
                const ok = await shareNwcWallet({
                  nwcUrl,
                  walletName: wallet.walletAlias || wallet.alias,
                });
                if (ok) Toast.show({ type: 'success', text1: t('nwcShareSheet.sentToast') });
              })();
            },
          },
        ],
      );
    },
    [nwcWallets, peerName, shareNwcWallet, onCloseAttachPanel, t],
  );

  // Recipient tapped Add on a shared-wallet card → re-show the trust warning,
  // then run the existing NWC import path.
  const addSharedWallet = useCallback(
    (card: NwcShareCard) => {
      Alert.alert(
        t('nwcShareCard.addConfirmTitle'),
        t('nwcShareCard.addConfirmBody', { name: peerName }),
        [
          { text: t('nwcShareSheet.cancel'), style: 'cancel' },
          {
            text: t('nwcShareCard.add'),
            onPress: () => {
              void (async () => {
                const validation = validateNwcUrl(card.nwcUrl);
                if (!validation.valid) {
                  Alert.alert(
                    t('nwcShareCard.addFailedTitle'),
                    validation.error ?? t('nwcShareCard.addFailedBody'),
                  );
                  return;
                }
                const alias = card.walletName?.trim() || t('nwcShareCard.defaultAlias');
                const result = await addNwcWallet(card.nwcUrl, alias, 'lightning-piggy');
                if (result.success) {
                  Toast.show({ type: 'success', text1: t('nwcShareCard.addedToast') });
                } else {
                  Alert.alert(
                    t('nwcShareCard.addFailedTitle'),
                    result.error ?? t('nwcShareCard.addFailedBody'),
                  );
                }
              })();
            },
          },
        ],
      );
    },
    [addNwcWallet, peerName, t],
  );

  return {
    nwcWallets,
    nwcPickerOpen,
    openNwcSharePicker,
    closeNwcPicker,
    shareToWallet,
    addSharedWallet,
  };
}
