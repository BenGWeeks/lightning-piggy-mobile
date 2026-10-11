import React from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useTranslation } from '../contexts/LocaleContext';
import type { SendSheetStyles } from '../styles/SendSheet.styles';
import type { ReverseRecipientQuote } from '../utils/reverseSwapAmounts';
import type { SendBlocker } from '../utils/onchainSendEligibility';

interface Props {
  /** Paid from a Lightning wallet through a Boltz reverse swap (vs a direct
   *  send from the on-chain hot wallet, which never touches Boltz). */
  viaBoltz: boolean;
  blocker: SendBlocker | null;
  /** Miner-fee line for the direct hot-wallet send. */
  hotWalletFee: string | null;
  loadingFees: boolean;
  /** Exact-recipient quote for the swap; null when fees are unavailable. */
  quote: ReverseRecipientQuote | null;
  styles: SendSheetStyles;
}

/**
 * Fee line under an on-chain destination in the Send sheet. A swap send
 * states both sides (#1175): what the recipient gets — exactly the entered
 * amount — and what the wallet pays once Boltz's and the network's fees are
 * added on top. The Boltz logo credits the swap provider.
 */
export default function SendOnchainFeeRow({
  viaBoltz,
  blocker,
  hotWalletFee,
  loadingFees,
  quote,
  styles,
}: Props) {
  const t = useTranslation();
  const reason = blocker ? t(blocker.key, blocker.params) : null;
  if (!viaBoltz) {
    return (
      <View style={styles.feeRow}>
        <Text style={styles.feeText}>{reason ?? hotWalletFee ?? t('sendSheet.estimatingFee')}</Text>
      </View>
    );
  }
  return (
    <View style={styles.feeRow}>
      <TouchableOpacity
        accessibilityRole="link"
        testID="send-boltz-info"
        onPress={() => Linking.openURL('https://boltz.exchange')}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel={t('sendSheet.poweredByBoltz')}
      >
        <ExpoImage
          source={require('../../assets/images/boltz-logo.png')}
          style={styles.boltzLogo}
          contentFit="contain"
        />
      </TouchableOpacity>
      {loadingFees ? (
        <Text style={styles.feeText}>{t('sendSheet.loadingFees')}</Text>
      ) : quote ? (
        <View style={styles.feeLines}>
          <Text style={[styles.feeText, styles.feeTextStart]} testID="send-swap-recipient-gets">
            {t('sendSheet.swapRecipientGets', { amount: quote.recipientSats.toLocaleString() })}
          </Text>
          <Text style={[styles.feeText, styles.feeTextStart]} testID="send-swap-you-pay">
            {t('sendSheet.swapYouPay', {
              total: quote.invoiceSats.toLocaleString(),
              fee: quote.feeSats.toLocaleString(),
            })}
          </Text>
          {reason && (
            <Text style={styles.feeText} testID="send-onchain-blocker">
              {reason}
            </Text>
          )}
        </View>
      ) : (
        <Text style={[styles.feeText, styles.feeLines]} testID="send-onchain-blocker">
          {reason ?? t('swapBackend.quoteFailed')}
        </Text>
      )}
    </View>
  );
}
