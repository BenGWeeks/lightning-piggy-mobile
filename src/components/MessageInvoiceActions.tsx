import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { Zap, QrCode, Copy } from 'lucide-react-native';
import Toast from './BrandedToast';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createMessageInvoiceActionsStyles } from '../styles/MessageInvoiceActions.styles';

interface Props {
  /** Bare bolt11 (no `lightning:` prefix), ready to pay / QR-encode / copy. */
  bolt11: string;
  /**
   * Hand the raw bolt11 to the parent — opens the SendSheet to pay with the
   * active Lightning Piggy wallet (loading / error / no-wallet handled there,
   * mirroring the marketplace order card's Pay).
   */
  onPayInvoice: (rawInvoice: string) => void;
  /** Maestro / a11y selector namespace, e.g. "conversation" / "group-conversation". */
  testIdPrefix: string;
  /** The message bubble id, for unique testIDs. */
  id: string;
}

/**
 * Pay + QR + Copy controls for a bolt11 invoice received in a DM (#948
 * follow-up). MessageBubble already detects a bolt11 in message text
 * (`extractInvoice`) and renders the amount / memo / expiry card — this adds the
 * same in-chat payment affordance the marketplace order card
 * ({@link OrderPaymentActions}) has, so a plain invoice pasted from any Nostr
 * client (or sent by a merchant that doesn't speak LP's kind-16 order protocol)
 * is one-tap payable, scannable with an external wallet, and copyable.
 *
 * Only rendered by MessageBubble for a *received*, live, unpaid invoice — the
 * caller already gates on `!fromMe && !paid && !expired` (a paid/expired invoice
 * shows its status pill instead, and you can't pay one you sent). No new
 * Lightning code: paying reuses the parent's SendSheet entry, and detection
 * reuses `extractInvoice`.
 */
function MessageInvoiceActions({
  bolt11,
  onPayInvoice,
  testIdPrefix,
  id,
}: Props): React.ReactElement {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMessageInvoiceActionsStyles(colors), [colors]);
  const [showQr, setShowQr] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(bolt11);
    Toast.show({
      type: 'success',
      text1: t('orderPaymentActions.invoiceCopied'),
      position: 'top',
      visibilityTime: 1800,
    });
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.payButton}
        onPress={() => onPayInvoice(bolt11)}
        accessibilityRole="button"
        accessibilityLabel={t('messageBubble.payInvoice')}
        testID={`${testIdPrefix}-pay-${id}`}
      >
        <Zap size={16} color={colors.white} fill={colors.white} />
        <Text style={styles.payButtonText}>{t('messageBubble.pay')}</Text>
      </TouchableOpacity>

      <View style={styles.secondaryRow}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => setShowQr((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={
            showQr ? t('orderPaymentActions.hideQrA11y') : t('orderPaymentActions.showQrA11y')
          }
          testID={`${testIdPrefix}-invoice-qr-toggle-${id}`}
        >
          <QrCode size={16} color={colors.brandPink} />
          <Text style={styles.secondaryButtonText}>
            {showQr ? t('orderPaymentActions.hideQr') : t('orderPaymentActions.showQr')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleCopy}
          accessibilityRole="button"
          accessibilityLabel={t('orderPaymentActions.copyInvoiceA11y')}
          testID={`${testIdPrefix}-invoice-copy-${id}`}
        >
          <Copy size={16} color={colors.brandPink} />
          <Text style={styles.secondaryButtonText}>{t('orderPaymentActions.copy')}</Text>
        </TouchableOpacity>
      </View>

      {showQr ? (
        <View
          style={styles.qrWrap}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('orderPaymentActions.qrCodeA11y')}
          testID={`${testIdPrefix}-invoice-qr-${id}`}
        >
          {/* Normalise to all-uppercase for QR efficiency: a bolt11 is
              single-case (typically lowercase), and an all-uppercase payload
              encodes in the compact alphanumeric QR mode. */}
          <QRCode
            value={bolt11.toUpperCase()}
            size={200}
            backgroundColor="#FFFFFF"
            color="#000000"
          />
          <Text style={styles.qrHint}>{t('orderPaymentActions.scanHint')}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default React.memo(MessageInvoiceActions);
