import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { Zap, QrCode, Copy, Check } from 'lucide-react-native';
import Toast from './BrandedToast';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createOrderPaymentActionsStyles } from '../styles/OrderPaymentActions.styles';
import { extractInvoice } from '../utils/messageContent';
import { payableBolt11, type ParsedOrderEvent } from '../utils/orderEvents';

interface Props {
  order: ParsedOrderEvent;
  fromMe: boolean;
  /** 1:1 settlement predicate (NWC poll + wallet-tx history). Flips Paid. */
  isInvoicePaid?: (paymentHash: string, fromMe: boolean) => boolean;
  /** Hand a raw bolt11 to the parent — opens the SendSheet to pay with the
   *  active Lightning Piggy wallet (loading / error / no-wallet handled there,
   *  mirroring MessageBubble's invoice "Pay"). */
  onPayInvoice: (rawInvoice: string) => void;
  /** Maestro / a11y selector namespace, e.g. "conversation". */
  testIdPrefix: string;
  /** The conversation item id, for unique testIDs. */
  id: string;
}

/**
 * Pay / QR affordance for a marketplace order card (#925 follow-up).
 *
 * - kind-17 **receipt** → already settled: a "Paid ✓" badge, no Pay button.
 * - kind-16 **type-2 Payment request** with a bolt11 → a **Pay** button (via
 *   the active wallet), a **QR** toggle, and a copy-invoice button so the buyer
 *   can also pay from an external wallet. Once the invoice settles (detected
 *   through `isInvoicePaid`, i.e. an outgoing wallet tx with the same payment
 *   hash) the Pay button is replaced by "Paid ✓".
 * - any other order type (placed / status / shipping) → renders nothing.
 *
 * No wallet connected is NOT handled here: `onPayInvoice` opens the SendSheet,
 * which guides the user to connect a wallet. The QR + copy remain available
 * regardless so an external wallet can always pay.
 */
function OrderPaymentActions({
  order,
  fromMe,
  isInvoicePaid,
  onPayInvoice,
  testIdPrefix,
  id,
}: Props): React.ReactElement | null {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createOrderPaymentActionsStyles(colors), [colors]);
  const [showQr, setShowQr] = useState(false);

  // A kind-17 receipt is proof of payment — show the paid state directly.
  const isReceipt = order.kind === 17 && order.type === 'receipt';

  const bolt11 = payableBolt11(order);

  // Derive payment hash + expiry from the invoice. extractInvoice never throws
  // (returns raw-only on a decode failure), so a malformed value degrades to
  // "show QR + copy, no expiry gating" rather than crashing the card.
  const decoded = useMemo(() => (bolt11 ? extractInvoice(bolt11) : null), [bolt11]);

  if (isReceipt) {
    return (
      <View style={styles.container}>
        <View
          style={styles.paidBadge}
          accessibilityLabel={t('orderPaymentActions.paymentReceivedA11y')}
          testID={`${testIdPrefix}-order-paid-${id}`}
        >
          <Check size={14} color={colors.greenDark} strokeWidth={3} />
          <Text style={styles.paidBadgeText}>{t('orderPaymentActions.paid')}</Text>
        </View>
      </View>
    );
  }

  // Nothing to pay (order placed / status / shipping, or no bolt11).
  if (!bolt11) return null;

  const paymentHash = decoded?.paymentHash ?? null;
  const paid = paymentHash !== null && (isInvoicePaid?.(paymentHash, fromMe) ?? false);
  const expired =
    !paid && decoded?.expiresAt !== null && decoded?.expiresAt !== undefined
      ? decoded.expiresAt * 1000 < Date.now()
      : false;

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
      {paid ? (
        <View
          style={styles.paidBadge}
          accessibilityLabel={t('orderPaymentActions.invoicePaidA11y')}
          testID={`${testIdPrefix}-order-paid-${id}`}
        >
          <Check size={14} color={colors.greenDark} strokeWidth={3} />
          <Text style={styles.paidBadgeText}>{t('orderPaymentActions.paid')}</Text>
        </View>
      ) : (
        <>
          {/* Pay with the active wallet. Hidden once paid/expired, and for a
              request the user themselves issued (fromMe) — they can't pay it. */}
          {!fromMe && !expired ? (
            <TouchableOpacity
              style={styles.payButton}
              onPress={() => onPayInvoice(bolt11)}
              accessibilityRole="button"
              accessibilityLabel={t('orderPaymentActions.payInvoiceA11y')}
              testID={`${testIdPrefix}-order-pay-${id}`}
            >
              <Zap size={16} color={colors.white} fill={colors.white} />
              <Text style={styles.payButtonText}>{t('orderPaymentActions.pay')}</Text>
            </TouchableOpacity>
          ) : null}

          {expired ? (
            <Text style={styles.expiredText} testID={`${testIdPrefix}-order-expired-${id}`}>
              {t('orderPaymentActions.invoiceExpired')}
            </Text>
          ) : null}

          <View style={styles.secondaryRow}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setShowQr((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={
                showQr ? t('orderPaymentActions.hideQrA11y') : t('orderPaymentActions.showQrA11y')
              }
              testID={`${testIdPrefix}-order-qr-toggle-${id}`}
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
              testID={`${testIdPrefix}-order-copy-${id}`}
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
              testID={`${testIdPrefix}-order-qr-${id}`}
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
        </>
      )}
    </View>
  );
}

export default React.memo(OrderPaymentActions);
