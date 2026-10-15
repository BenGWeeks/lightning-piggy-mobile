import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Check, RefreshCw, Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useLocale } from '../contexts/LocaleContext';
import { useNostr } from '../contexts/NostrContext';
import { useSellerOrderQuote } from '../hooks/useSellerOrderQuote';
import { SellerInvoiceError, useSellerInvoice } from '../hooks/useSellerInvoice';
import { createSellerOrderPanelStyles } from '../styles/SellerOrderPanel.styles';
import { formatMarketAmount } from '../utils/marketListingShipping';
import { localizeDeliveryAddress } from '../utils/deliveryAddress';
import { orderOwnership } from '../utils/sellerOrderQuote';
import { expiresAtFromBolt11, paymentHashFromBolt11 } from '../utils/bolt11';
import {
  receiptProvesPayment,
  shopOrderStatus,
  type SellerOrderThread,
} from '../utils/shopOrderStatus';
import type { ParsedOrderEvent } from '../utils/orderEvents';
import OrderStatusChip from './OrderStatusChip';
import SellerInvoiceSheet from './SellerInvoiceSheet';
import { Toast } from './BrandedToast';

interface Props {
  /** The buyer's kind-16 type-1 order. */
  order: ParsedOrderEvent;
  /** What I've done about it so far (from the conversation's order rows). */
  thread?: SellerOrderThread;
  /** The buyer (this conversation's peer). */
  buyerPubkey: string;
  /** Unique suffix for testIDs. */
  id: string;
}

const CONFIRMED = new Set(['confirmed', 'processing', 'completed']);

/**
 * The seller's side of an incoming Gamma order, shown in the order card when
 * every item is one of MY listings (anything else renders nothing — not mine
 * to invoice). Items, shipping and the total are priced from my OWN current
 * listing / shipping events (useSellerOrderQuote); the buyer's stated amount
 * must match the computed total before invoicing. Then: Send invoice (on a wallet I pick)
 * → wait for payment on THAT wallet → Mark paid.
 */
function SellerOrderPanel({ order, thread, buyerPubkey, id }: Props): React.ReactElement | null {
  const colors = useThemeColors();
  const { t, locale, formatLocale } = useLocale();
  const styles = useMemo(() => createSellerOrderPanelStyles(colors), [colors]);
  const { pubkey } = useNostr();
  const mine = pubkey ? orderOwnership(order, pubkey) === 'mine' : false;
  const { quote, quoteCurrent, loading } = useSellerOrderQuote(mine ? order : null);
  const invoice = useSellerInvoice(mine ? buyerPubkey : null, mine ? order.orderId : null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errorText = useCallback(
    (e: unknown) =>
      t(`sellerOrders.errors.${e instanceof SellerInvoiceError ? e.code : 'sendFailed'}`),
    [t],
  );
  const onConfirm = useCallback(
    async (walletId: string, remember: boolean) => {
      setError(null);
      try {
        const current = quoteCurrent();
        if (current?.totalSats == null || current.totalSats !== quote?.totalSats) {
          throw new SellerInvoiceError('shopChanged', 'Shop pricing changed; review the order');
        }
        if (current.totalSats !== order.amountSats) {
          throw new SellerInvoiceError('amountMismatch', 'Buyer has not approved this total');
        }
        await invoice.sendInvoice({ walletId, amountSats: current.totalSats, remember });
        Toast.show({ type: 'success', text1: t('sellerOrders.invoiceSent') });
      } catch (e) {
        setError(errorText(e));
        throw e;
      }
    },
    [invoice, order.amountSats, quote?.totalSats, quoteCurrent, t, errorText],
  );
  const onMarkPaid = useCallback(async () => {
    try {
      await invoice.markPaid();
      Toast.show({ type: 'success', text1: t('sellerOrders.buyerNotified') });
    } catch (e) {
      Toast.show({ type: 'error', text1: errorText(e) });
    }
  }, [invoice, t, errorText]);
  const onCheckPaid = useCallback(async () => {
    try {
      const paid = await invoice.checkPaid();
      if (!paid) Toast.show({ type: 'info', text1: t('sellerOrders.notPaidYet') });
    } catch (e) {
      Toast.show({ type: 'error', text1: errorText(e) });
    }
  }, [invoice, t, errorText]);

  const expiresAt =
    thread?.invoice?.expiresAt ??
    (invoice.record ? expiresAtFromBolt11(invoice.record.bolt11) : null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (expiresAt === null || expiresAt * 1000 <= Date.now()) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(expiresAt * 1000 - Date.now(), 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [expiresAt]);

  if (!mine) return null;
  if (!quote || (loading && quote.problem === 'missingListing')) {
    return (
      <View style={styles.container}>
        <Text style={styles.muted}>{t('sellerOrders.loadingShop')}</Text>
      </View>
    );
  }

  // Which invoice to watch: the one I recorded on this device for this order.
  const record = invoice.record;
  const invoiceHash = thread?.invoice
    ? paymentHashFromBolt11(thread.invoice.bolt11)
    : (record?.paymentHash ?? null);
  const receiptVerified = thread ? receiptProvesPayment(thread, invoiceHash) : false;
  const walletPaid = Boolean(record?.paidAt);
  const status = thread
    ? shopOrderStatus(thread, { walletPaid, receiptVerified })
    : record
      ? walletPaid
        ? 'paid'
        : 'invoiceSent'
      : 'needsInvoice';
  const confirmedSent =
    Boolean(record?.confirmedAt) || (thread?.status !== undefined && CONFIRMED.has(thread.status));
  const canReplace =
    status === 'invoiceSent' &&
    Boolean(record) &&
    (!thread?.invoice || thread.invoice.bolt11 === record?.bolt11) &&
    expiresAt !== null &&
    expiresAt * 1000 <= now;
  const canRetry =
    status === 'invoiceSent' &&
    Boolean(record?.deliveryPending) &&
    !record?.paidAt &&
    !confirmedSent &&
    (!thread?.invoice || thread.invoice.bolt11 === record?.bolt11) &&
    (expiresAt === null || expiresAt * 1000 > now);
  const busy = invoice.sending;
  const invoiceBlocked = quote.totalSats === null || quote.totalSats !== order.amountSats || busy;
  const sats = (n: number) => t('market.sats', { amount: n.toLocaleString(formatLocale) });

  return (
    <View style={styles.container} testID={`seller-order-panel-${id}`}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>{t('sellerOrders.yourShopOrder')}</Text>
        <OrderStatusChip status={status} testID={`seller-order-status-${id}`} />
      </View>

      {quote.problem && quote.problem !== 'noRate' ? (
        <Text style={styles.warning} testID={`seller-order-problem-${id}`}>
          {t(`sellerOrders.problems.${quote.problem}`)}
        </Text>
      ) : null}

      {quote.lines.map((line) => (
        <View key={line.ref}>
          <View style={styles.lineRow}>
            <Text style={styles.lineTitle} numberOfLines={2}>
              {t('sellerOrders.lineTitle', { title: line.title, qty: line.quantity })}
            </Text>
            <Text style={styles.lineAmount}>
              {line.lineSats !== null ? sats(line.lineSats) : '—'}
            </Text>
          </View>
          <Text style={styles.lineSub}>
            {t('sellerOrders.unitPrice', {
              amount: formatMarketAmount(line.unitAmount, line.currency),
              currency: line.currency,
            })}
          </Text>
          {line.overStock ? (
            <Text style={styles.warning}>
              {t('sellerOrders.overStock', { stock: line.stock ?? 0 })}
            </Text>
          ) : null}
        </View>
      ))}

      {quote.shipping ? (
        <View style={styles.lineRow}>
          <Text style={styles.lineTitle}>
            {t('sellerOrders.shippingLine', { title: quote.shipping.title })}
          </Text>
          <Text style={styles.lineAmount}>
            {quote.shipping.sats === null
              ? '—'
              : quote.shipping.sats === 0
                ? t('market.free')
                : sats(quote.shipping.sats)}
          </Text>
        </View>
      ) : null}
      {quote.shipping?.notOffered ? (
        <Text style={styles.warning}>{t('sellerOrders.shippingNotOffered')}</Text>
      ) : null}
      {quote.shippingMissing ? (
        <Text style={styles.warning}>{t('sellerOrders.shippingMissing')}</Text>
      ) : null}

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>{t('sellerOrders.total')}</Text>
        <View style={styles.totalValue}>
          <Text style={styles.totalSats} testID={`seller-order-total-${id}`}>
            {quote.totalSats !== null
              ? sats(quote.totalSats)
              : quote.problem === 'noRate'
                ? t('sellerOrders.waitingForRate')
                : '—'}
          </Text>
          {quote.fiatTotal ? (
            <Text style={styles.totalFiat}>
              {t('sellerOrders.fiatAtRate', {
                amount: formatMarketAmount(quote.fiatTotal.amount, quote.fiatTotal.currency),
                currency: quote.fiatTotal.currency,
              })}
            </Text>
          ) : null}
        </View>
      </View>
      {quote.amountMismatch && quote.buyerAmountSats !== null ? (
        <Text style={styles.warning} testID={`seller-order-mismatch-${id}`}>
          {t('sellerOrders.amountDiffers', {
            buyer: quote.buyerAmountSats.toLocaleString(formatLocale),
          })}
        </Text>
      ) : null}

      {order.address ? (
        <Text style={styles.detail} selectable testID={`seller-order-address-${id}`}>
          <Text style={styles.detailLabel}>{t('sellerOrders.shipTo')} </Text>
          {localizeDeliveryAddress(order.address, locale)}
        </Text>
      ) : null}
      {order.email || order.phone || order.contact ? (
        <Text style={styles.detail} selectable>
          <Text style={styles.detailLabel}>{t('sellerOrders.contact')} </Text>
          {[order.email, order.phone, order.contact].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      {order.message || order.notes ? (
        <Text style={styles.detail} selectable>
          {[order.message, order.notes].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      {thread?.receipt && !receiptVerified ? (
        <Text style={styles.muted}>{t('sellerOrders.receiptUnverified')}</Text>
      ) : null}

      <View style={styles.actions}>
        {status === 'needsInvoice' || canReplace || canRetry ? (
          <TouchableOpacity
            style={[styles.primaryButton, invoiceBlocked && styles.buttonDisabled]}
            onPress={() => {
              setError(null);
              setSheetVisible(true);
            }}
            disabled={invoiceBlocked}
            accessibilityRole="button"
            accessibilityLabel={t('sellerOrders.sendInvoice')}
            testID={`seller-order-send-invoice-${id}`}
          >
            <Zap size={14} color={colors.white} strokeWidth={2.5} fill={colors.white} />
            <Text style={styles.primaryButtonText}>{t('sellerOrders.sendInvoice')}</Text>
          </TouchableOpacity>
        ) : null}
        {status === 'invoiceSent' && record ? (
          <TouchableOpacity
            style={[styles.secondaryButton, invoice.checking && styles.buttonDisabled]}
            onPress={onCheckPaid}
            disabled={invoice.checking}
            accessibilityRole="button"
            accessibilityLabel={t('sellerOrders.checkPayment')}
            testID={`seller-order-check-paid-${id}`}
          >
            <RefreshCw size={14} color={colors.brandPink} strokeWidth={2.5} />
            <Text style={styles.secondaryButtonText}>{t('sellerOrders.checkPayment')}</Text>
          </TouchableOpacity>
        ) : null}
        {status === 'invoiceSent' && !record ? (
          <Text style={styles.muted}>{t('sellerOrders.waitingForPayment')}</Text>
        ) : null}
        {status === 'paid' && !confirmedSent ? (
          <TouchableOpacity
            style={[styles.primaryButton, busy && styles.buttonDisabled]}
            onPress={onMarkPaid}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('sellerOrders.markPaid')}
            testID={`seller-order-mark-paid-${id}`}
          >
            <Check size={14} color={colors.white} strokeWidth={3} />
            <Text style={styles.primaryButtonText}>{t('sellerOrders.markPaid')}</Text>
          </TouchableOpacity>
        ) : null}
        {status === 'paid' && confirmedSent ? (
          <Text style={styles.muted}>{t('sellerOrders.buyerNotified')}</Text>
        ) : null}
      </View>

      {quote.totalSats !== null ? (
        <SellerInvoiceSheet
          visible={sheetVisible}
          onClose={() => setSheetVisible(false)}
          orderId={order.orderId}
          totalSats={quote.totalSats}
          fiatTotal={quote.fiatTotal}
          buyerAmountSats={quote.buyerAmountSats}
          onConfirm={onConfirm}
          error={error}
        />
      ) : null}
    </View>
  );
}

export default React.memo(SellerOrderPanel);
