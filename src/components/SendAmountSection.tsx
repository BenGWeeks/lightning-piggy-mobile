import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { satsToFiatString } from '../services/fiatService';
import type { LnurlPayParams } from '../services/lnurlService';
import { lnurlFixedAmountSats } from '../utils/sendSheetInput';
import type { SendSheetStyles } from '../styles/SendSheet.styles';

interface Props {
  needsAmount: boolean;
  resolving: boolean;
  lnurlParams: LnurlPayParams | null;
  isOnchainAddress: boolean;
  isAmountlessBolt11: boolean;
  currentSats: number;
  decodedAmountSats: number | null | undefined;
  btcPrice: number | null;
  currency: string;
  onEnterAmount: () => void;
  styles: SendSheetStyles;
  spinnerColor: string;
}

// The amount area of the Send details card, extracted from SendSheet (over
// the file-size cap). Three shapes: an amount picker row when the user must
// choose a value, a read-only display when the amount is already pinned
// (bolt11 with amount, or fixed-range LNURL where min === max, #833), and a
// fallback label when no amount is known.
const SendAmountSection: React.FC<Props> = ({
  needsAmount,
  resolving,
  lnurlParams,
  isOnchainAddress,
  isAmountlessBolt11,
  currentSats,
  decodedAmountSats,
  btcPrice,
  currency,
  onEnterAmount,
  styles,
  spinnerColor,
}) => {
  const lnurlFixedSats = lnurlFixedAmountSats(lnurlParams);

  if (needsAmount && lnurlFixedSats !== null) {
    // Fixed-amount LNURL: nothing to choose, so no picker — the value was
    // pre-filled by useSendSheetLnurl and Send is enabled immediately.
    return (
      <View style={styles.amountSection}>
        <View style={styles.amountDisplay} testID="send-amount-fixed">
          <Text style={styles.amountValue}>{lnurlFixedSats.toLocaleString()} sats</Text>
          {btcPrice ? (
            <Text style={styles.amountFiat}>
              {satsToFiatString(lnurlFixedSats, btcPrice, currency)}
            </Text>
          ) : null}
        </View>
        <Text style={styles.rangeText}>Fixed amount</Text>
      </View>
    );
  }

  if (needsAmount) {
    return (
      <View style={styles.amountSection}>
        {resolving ? (
          <ActivityIndicator size="small" color={spinnerColor} />
        ) : lnurlParams || isOnchainAddress || isAmountlessBolt11 ? (
          <TouchableOpacity
            style={styles.amountPickerRow}
            onPress={onEnterAmount}
            testID="send-amount-picker"
            accessibilityLabel="Enter amount"
          >
            {currentSats > 0 ? (
              <>
                <Text style={styles.amountPickerValue}>{currentSats.toLocaleString()} sats</Text>
                {btcPrice ? (
                  <Text style={styles.amountPickerFiat}>
                    {satsToFiatString(currentSats, btcPrice, currency)}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.amountPickerPlaceholder}>Enter amount</Text>
            )}
          </TouchableOpacity>
        ) : null}
        {lnurlParams ? (
          <Text style={styles.rangeText}>
            {lnurlParams.minSats.toLocaleString()} – {lnurlParams.maxSats.toLocaleString()} sats
          </Text>
        ) : null}
      </View>
    );
  }

  if (decodedAmountSats !== null && decodedAmountSats !== undefined) {
    return (
      <View style={styles.amountDisplay}>
        <Text style={styles.amountValue}>{decodedAmountSats.toLocaleString()} sats</Text>
        {btcPrice ? (
          <Text style={styles.amountFiat}>
            {satsToFiatString(decodedAmountSats, btcPrice, currency)}
          </Text>
        ) : null}
      </View>
    );
  }

  return <Text style={styles.amountValue}>Amount not specified</Text>;
};

export default SendAmountSection;
