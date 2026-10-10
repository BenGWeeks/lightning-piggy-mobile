import { useCallback } from 'react';
import { Alert } from '../components/BrandedAlert';
import { useTranslation } from '../contexts/LocaleContext';
import { useNostr } from '../contexts/NostrContext';
import { useWallet, useWalletLive } from '../contexts/WalletContext';
import { satsToFiatString } from '../services/fiatService';
import { getSendThreshold, shouldConfirmSend } from '../services/sendThresholdService';
import type { ReverseRecipientQuote } from '../utils/reverseSwapAmounts';

/**
 * The Send sheet's high-value confirmation gate (#82): resolves true when the
 * send may proceed — at once below the user's threshold, otherwise after an
 * explicit Confirm. Call it before touching the abort controller / spinner /
 * overlay so a Cancel leaves the form exactly as it was.
 *
 * `amountSats` is what the user is authorising (an amount-bearing BOLT11's own
 * amount wins over a leftover typed one). A Boltz swap send authorises its
 * TOTAL — recipient amount plus fees — so the threshold and the prompt use
 * that, and the prompt states both sides (#1175).
 */
export function useLargeSendConfirm() {
  const t = useTranslation();
  const { currency } = useWallet();
  const { btcPrice } = useWalletLive();
  // The ACTIVE account's threshold — it is a per-account setting.
  const { pubkey } = useNostr();
  return useCallback(
    async (opts: {
      amountSats: number;
      /** Who / where the payment goes — an address, never a UI label. */
      recipient: string;
      swapQuote: ReverseRecipientQuote | null;
    }): Promise<boolean> => {
      const { recipient, swapQuote } = opts;
      const authorised = swapQuote?.invoiceSats ?? opts.amountSats;
      if (!shouldConfirmSend(authorised, await getSendThreshold(pubkey))) return true;
      const fiatOf = (sats: number) =>
        btcPrice !== null ? ` (${satsToFiatString(sats, btcPrice, currency)})` : '';
      const body = swapQuote
        ? t('sendSheet.confirmLargeSwapBody', {
            recipient,
            amount: swapQuote.recipientSats.toLocaleString(),
            fiat: fiatOf(swapQuote.recipientSats),
            total: swapQuote.invoiceSats.toLocaleString(),
            fee: swapQuote.feeSats.toLocaleString(),
          })
        : t('sendSheet.confirmLargeSendBody', {
            amount: authorised.toLocaleString(),
            fiat: fiatOf(authorised),
            recipient,
          });
      return new Promise<boolean>((resolve) => {
        Alert.alert(t('sendSheet.confirmLargeSendTitle'), body, [
          { text: t('sendSheet.cancel'), style: 'cancel', onPress: () => resolve(false) },
          { text: t('sendSheet.confirm'), onPress: () => resolve(true) },
        ]);
      });
    },
    [t, currency, btcPrice, pubkey],
  );
}
