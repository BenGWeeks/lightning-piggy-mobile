import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Zap, Plus, Minus, Check, ExternalLink, LogIn } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createMarketCheckoutSheetStyles } from '../styles/MarketCheckoutSheet.styles';
import { useMarketCheckout } from '../hooks/useMarketCheckout';
import type { OrderShippingInput } from '../utils/marketOrder';
import { useShippingOptions } from '../hooks/useShippingOptions';
import { getBtcPrice } from '../services/fiatService';
import {
  filterShippingOptions,
  shippingCostFor,
  shippingCostSats,
  orderTotalWithShippingSats,
} from '../utils/marketShipping';
import { deviceCountryCode } from '../data/countries';
import MarketShippingSection from './MarketShippingSection';
import CountryPickerSheet from './CountryPickerSheet';
import Toast from './BrandedToast';
import type { MarketProduct } from '../data/marketProducts';

interface Props {
  visible: boolean;
  onClose: () => void;
  product: MarketProduct;
  sellerName: string;
  /** Merchant's Nostr pubkey (hex) — the order recipient. Required for in-app checkout. */
  vendorPubkey: string;
  /** Seller logo, threaded into the conversation the buyer lands in. */
  vendorLogo?: string;
  /** Open the sign-in sheet (owned by the parent screen). */
  onRequestSignIn: () => void;
  /** Fired after a successful order so the parent can navigate to the vendor conversation. */
  onPlaced: (info: { vendorPubkey: string; vendorName: string; vendorLogo?: string }) => void;
}

const MAX_QTY = 99;
const MAX_RATE_RETRIES = 2;
const RATE_RETRY_MS = 3000;

/**
 * In-app Market checkout (#market). Replaces the old "open the seller's website"
 * link with a place-order-and-pay round trip: the buyer confirms product +
 * quantity, taps **Place order**, and LP gift-wraps a kind-16 `type-1` order to
 * the merchant (NIP-17) via {@link useMarketCheckout}. The merchant's order
 * service replies with a kind-16 `type-2` payment request (a payable order
 * card, #928) in the vendor conversation, which the buyer is navigated to so
 * they can pay it with their Lightning Piggy wallet.
 *
 * Sign-in is gated: a logged-out buyer is prompted to sign in first (the order
 * must be signed by their key). The seller's external `url` is kept as a
 * fallback link for buyers who'd rather use the website.
 */
const MarketCheckoutSheet: React.FC<Props> = ({
  visible,
  onClose,
  product,
  sellerName,
  vendorPubkey,
  vendorLogo,
  onRequestSignIn,
  onPlaced,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMarketCheckoutSheetStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  const { status, error, isPlacing, canOrder, placeOrder, reset } = useMarketCheckout();

  const [quantity, setQuantity] = useState(1);
  const [imageFailed, setImageFailed] = useState(false);
  // In-flight guard for the WHOLE submit path (rate revalidation + publish):
  // `isPlacing` only covers the hook's publish, so the ref (synchronous) stops
  // a double tap and the state disables the button / locks the selection.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  // --- Country-first shipping (#948 Option A) ---
  const shipping = useShippingOptions(visible ? vendorPubkey : null, visible);
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const [selectedCoordinate, setSelectedCoordinate] = useState<string | null>(null);
  // BTC spot price per fiat currency the options quote in (null = fetch
  // failed → the option can't be priced in sats and submit stays blocked).
  // Plain Record, not a Map: it holds 1-3 currencies fetched once per
  // sheet open, and all results commit as a single state write below.
  const [btcPriceByCurrency, setBtcPriceByCurrency] = useState<
    Record<string, number | null | undefined>
  >({});
  // A failed quote (null) is retried a bounded number of times, ~3 s apart, so
  // a transient rate outage recovers without closing and reopening the sheet.
  const [rateAttempt, setRateAttempt] = useState(0);

  useEffect(() => {
    if (visible) {
      setQuantity(1);
      setImageFailed(false);
      // Pre-select the device-locale country (spec: user can change it).
      setCountryCode(deviceCountryCode());
      setSelectedCoordinate(null);
      // Fresh spot rates per open: a failed quote (null) must retry, and a
      // rate older than fiatService's cache window must not price shipping.
      setBtcPriceByCurrency({});
      setRateAttempt(0);
      reset();
      sheetRef.current?.present();
    } else {
      // The picker is an independently presented modal — dismiss it with us.
      setCountryPickerVisible(false);
      sheetRef.current?.dismiss();
    }
  }, [visible, reset]);

  // The merchant publishes shipping options ⇔ the country-first flow is on.
  // Zero published options (a digital-goods seller) skips the section — the
  // pre-shipping checkout behaviour, unchanged.
  const hasShipping = shipping.status === 'ready' && shipping.options.length > 0;

  // Fetch a BTC spot price once per distinct fiat currency the options use.
  // All fetches settle together and commit as ONE state write — no
  // per-result re-render (and no per-event clone for the perf gate).
  useEffect(() => {
    if (!hasShipping) return;
    const fiat = [
      ...new Set(
        shipping.options
          .map((o) => o.currency)
          .filter((c) => c && c !== 'SATS' && c !== 'SAT' && c !== 'BTC'),
      ),
    ].filter((c) => !(c in btcPriceByCurrency) || btcPriceByCurrency[c] === null);
    if (fiat.length === 0) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    Promise.all(
      fiat.map((currency) =>
        // No stale fallback: an expired rate must not price a payable total.
        getBtcPrice(currency, { allowStale: false })
          .then((price) => [currency, price] as const)
          .catch(() => [currency, null] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setBtcPriceByCurrency((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      if (entries.some(([, price]) => price === null) && rateAttempt < MAX_RATE_RETRIES) {
        retryTimer = setTimeout(() => setRateAttempt((a) => a + 1), RATE_RETRY_MS);
      }
    });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // btcPriceByCurrency intentionally omitted: the null-or-missing guard
    // already prevents refetch loops, and depending on it would refire per
    // result; `rateAttempt` is the deliberate retry trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShipping, shipping.options, rateAttempt]);

  const compatibleOptions = useMemo(
    () => (hasShipping && countryCode ? filterShippingOptions(shipping.options, countryCode) : []),
    [hasShipping, shipping.options, countryCode],
  );

  // Reactivity: changing country re-filters; if the current selection became
  // incompatible, clear it so the buyer must re-pick (spec §3).
  useEffect(() => {
    if (!selectedCoordinate) return;
    if (!compatibleOptions.some((o) => o.coordinate === selectedCoordinate)) {
      setSelectedCoordinate(null);
    }
  }, [compatibleOptions, selectedCoordinate]);

  // All-in sats cost per option (base + product surcharge; static catalogue
  // products carry no surcharge refs yet, so cost = base). null = no rate.
  const costSatsByCoordinate = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const option of shipping.options) {
      const amount = shippingCostFor(option);
      map.set(
        option.coordinate,
        shippingCostSats(amount, option.currency, btcPriceByCurrency[option.currency] ?? null),
      );
    }
    return map;
  }, [shipping.options, btcPriceByCurrency]);

  const selectedOption = useMemo(
    () =>
      selectedCoordinate
        ? (compatibleOptions.find((o) => o.coordinate === selectedCoordinate) ?? null)
        : null,
    [compatibleOptions, selectedCoordinate],
  );
  const selectedShippingSats = selectedOption
    ? (costSatsByCoordinate.get(selectedOption.coordinate) ?? null)
    : null;
  // Live selection, readable after an await: the submit handler captured a
  // render-time selection and must not sign a different one.
  const liveSelectionRef = useRef({
    coordinate: selectedCoordinate,
    country: countryCode,
    quantity,
  });
  liveSelectionRef.current = { coordinate: selectedCoordinate, country: countryCode, quantity };

  // Submit gate (spec §6): until shipping has settled to `ready` we can't know
  // whether shipping is required, so block for every non-ready state —
  // `idle` (the initial render before the load effect fires), `loading`, and
  // `error` alike. Once ready, only require a country + a compatible option
  // with a priceable sats cost when the merchant actually has options.
  const subtotalSats = product.priceSats * quantity;
  // The displayed total is only known once shipping has settled: `ready` with
  // no options (digital goods) or a priced selection. Until then it renders as
  // "—" rather than the bare subtotal masquerading as the order total.
  const shippingSettled =
    shipping.status === 'ready' && (!hasShipping || selectedShippingSats !== null);
  const totalSats = shippingSettled
    ? orderTotalWithShippingSats(subtotalSats, selectedShippingSats ?? 0)
    : null;
  const shippingBlocksSubmit =
    totalSats === null ||
    shipping.status !== 'ready' ||
    (hasShipping && (!countryCode || !selectedOption || selectedShippingSats === null));

  // While an order is in flight the sheet must not be dismissable (pan or
  // backdrop): a hidden sheet finishing a publish could later reopen onto a
  // stale success/error state or let a second order through.
  const dismissLocked = submitting || isPlacing;
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        pressBehavior={dismissLocked ? 'none' : 'close'}
      />
    ),
    [dismissLocked],
  );

  const hasThumb = product.image.length > 0 && !imageFailed;

  const handlePlace = useCallback(async () => {
    if (!canOrder) {
      onRequestSignIn();
      return;
    }
    if (shippingBlocksSubmit) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      let shippingInput: OrderShippingInput | undefined;
      if (hasShipping && selectedOption && selectedShippingSats !== null) {
        let costSats: number | null = selectedShippingSats;
        const cur = selectedOption.currency.trim().toUpperCase();
        if (cur !== 'SATS' && cur !== 'SAT' && cur !== 'BTC') {
          // Revalidate at submit: the sheet may have sat open past the rate's
          // 5-minute TTL, and the signed order total must not use an expired
          // conversion. Served from cache while fresh, refetched otherwise;
          // an outage yields null → block and hand off to the retry loop.
          const fresh = await getBtcPrice(cur, { allowStale: false });
          setBtcPriceByCurrency((prev) => ({ ...prev, [cur]: fresh }));
          // Selection changed while we awaited (the section is locked, but a
          // queued tap can still land) → don't sign the captured one.
          if (
            liveSelectionRef.current.coordinate !== selectedOption.coordinate ||
            liveSelectionRef.current.country !== countryCode ||
            liveSelectionRef.current.quantity !== quantity
          ) {
            return;
          }
          costSats = shippingCostSats(shippingCostFor(selectedOption), cur, fresh);
          if (costSats === null) {
            setRateAttempt((a) => a + 1);
            return;
          }
          // Never sign a total the buyer hasn't seen: if the fresh rate moves
          // the shipping sats, let the sheet re-render with the new total and
          // require a second tap.
          if (costSats !== selectedShippingSats) {
            Toast.show({
              type: 'info',
              text1: t('market.checkout.rateUpdated'),
              position: 'top',
              visibilityTime: 3000,
            });
            return;
          }
        }
        shippingInput = {
          coordinate: selectedOption.coordinate,
          costSats,
          title: selectedOption.title,
        };
      }
      await placeOrder({
        vendorPubkey,
        dTag: product.id,
        priceSats: product.priceSats,
        quantity,
        shipping: shippingInput,
      });
      Toast.show({
        type: 'success',
        text1: t('market.checkout.toastPlaced'),
        text2: t('market.checkout.toastPlacedBody', { seller: sellerName }),
        position: 'top',
        visibilityTime: 2600,
      });
    } catch {
      // Error surfaced inline via `error`; nothing else to do here.
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [
    canOrder,
    onRequestSignIn,
    placeOrder,
    vendorPubkey,
    product.id,
    product.priceSats,
    quantity,
    sellerName,
    shippingBlocksSubmit,
    hasShipping,
    selectedOption,
    selectedShippingSats,
    countryCode,
    t,
  ]);

  const handleGoToConversation = useCallback(() => {
    onPlaced({ vendorPubkey, vendorName: sellerName, vendorLogo });
    onClose();
  }, [onPlaced, vendorPubkey, sellerName, vendorLogo, onClose]);

  const openWebsite = useCallback(() => {
    Linking.openURL(product.url).catch(() => {
      // Swallow — a malformed/unsupported URL shouldn't crash the sheet.
    });
  }, [product.url]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      enablePanDownToClose={!dismissLocked}
      enableDynamicSizing
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handle}
      onDismiss={onClose}
    >
      {/* Scrollable body: a merchant can publish many shipping options, and a
          dynamically-sized sheet is capped by the viewport — the list and the
          Place order button must stay reachable. */}
      <BottomSheetScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        testID="market-checkout-sheet"
      >
        {status === 'sent' ? (
          <View style={styles.sentWrap}>
            <View style={styles.sentBadge}>
              <Check size={28} color={colors.greenDark} strokeWidth={3} />
            </View>
            <Text style={styles.sentTitle}>{t('market.checkout.orderPlaced')}</Text>
            <Text style={styles.sentBody}>
              {t('market.checkout.orderSentBody', { seller: sellerName })}
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleGoToConversation}
              accessibilityRole="button"
              accessibilityLabel={t('market.checkout.openConversation', { seller: sellerName })}
              testID="market-checkout-goto-conversation"
            >
              <Zap size={16} color={colors.white} strokeWidth={2.5} fill={colors.white} />
              {/* numberOfLines + adjustsFontSizeToFit + flexShrink guarantee the
                  label always fits on one line: under @gorhom/bottom-sheet's
                  `enableDynamicSizing` measure pass the button can briefly hug
                  its content instead of filling the centered success column, and
                  a plain <Text> would then clip ("o to chat to pa"). Shrinking
                  the font (down to 85%) rather than the text is the robust fix. */}
              <Text
                style={styles.primaryButtonText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                {t('market.checkout.goToChat')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.title}>{t('market.detail.buyFrom', { seller: sellerName })}</Text>

            <View style={styles.productRow}>
              {hasThumb ? (
                <Image
                  source={{ uri: product.image }}
                  style={styles.thumb}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={product.image}
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <View style={styles.thumbFallback}>
                  <Text style={styles.thumbFallbackText}>
                    {product.title.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.productInfo}>
                <Text style={styles.productTitle} numberOfLines={2}>
                  {product.title}
                </Text>
                <Text style={styles.productSeller}>
                  {t('market.fromSeller', { seller: sellerName })}
                </Text>
                <Text style={styles.unitPrice}>
                  {t('market.checkout.unitPrice', {
                    amount: product.priceSats.toLocaleString(),
                    fiat: product.priceFiatLabel,
                  })}
                </Text>
              </View>
            </View>

            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('market.checkout.quantity')}</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={[styles.stepButton, quantity <= 1 && styles.stepButtonDisabled]}
                  onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1 || submitting || isPlacing}
                  accessibilityRole="button"
                  accessibilityLabel={t('market.checkout.decreaseQuantity')}
                  testID="market-checkout-qty-minus"
                >
                  <Minus
                    size={18}
                    color={quantity <= 1 ? colors.divider : colors.brandPink}
                    strokeWidth={2.5}
                  />
                </TouchableOpacity>
                <Text style={styles.qtyText} testID="market-checkout-qty">
                  {quantity}
                </Text>
                <TouchableOpacity
                  style={[styles.stepButton, quantity >= MAX_QTY && styles.stepButtonDisabled]}
                  onPress={() => setQuantity((q) => Math.min(MAX_QTY, q + 1))}
                  disabled={quantity >= MAX_QTY || submitting || isPlacing}
                  accessibilityRole="button"
                  accessibilityLabel={t('market.checkout.increaseQuantity')}
                  testID="market-checkout-qty-plus"
                >
                  <Plus
                    size={18}
                    color={quantity >= MAX_QTY ? colors.divider : colors.brandPink}
                    strokeWidth={2.5}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {shipping.status !== 'idle' && (hasShipping || shipping.status !== 'ready') ? (
              <MarketShippingSection
                status={shipping.status}
                retry={shipping.retry}
                compatibleOptions={compatibleOptions}
                countryCode={countryCode}
                onOpenCountryPicker={() => {
                  if (!submitting) setCountryPickerVisible(true);
                }}
                selectedCoordinate={selectedCoordinate}
                onSelectOption={(coordinate) => {
                  if (!submitting) setSelectedCoordinate(coordinate);
                }}
                costSatsByCoordinate={costSatsByCoordinate}
                sellerName={sellerName}
                onMessageShop={handleGoToConversation}
              />
            ) : null}

            {hasShipping ? (
              <>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>{t('market.checkout.subtotal')}</Text>
                  <Text style={styles.summaryValue} testID="market-checkout-subtotal">
                    {t('market.sats', { amount: subtotalSats?.toLocaleString() ?? '—' })}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>{t('market.checkout.shipping')}</Text>
                  <Text style={styles.summaryValue} testID="market-checkout-shipping">
                    {selectedShippingSats !== null
                      ? selectedShippingSats === 0
                        ? t('market.free')
                        : t('market.sats', { amount: selectedShippingSats.toLocaleString() })
                      : '—'}
                  </Text>
                </View>
              </>
            ) : null}

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{t('market.checkout.total')}</Text>
              <View style={styles.totalValue}>
                <Zap size={16} color={colors.brandPink} strokeWidth={2.5} fill={colors.brandPink} />
                <Text style={styles.totalSats} testID="market-checkout-total">
                  {t('market.sats', { amount: totalSats?.toLocaleString() ?? '—' })}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                (isPlacing || submitting || (canOrder && shippingBlocksSubmit)) &&
                  styles.primaryButtonDisabled,
              ]}
              onPress={handlePlace}
              disabled={isPlacing || submitting || (canOrder && shippingBlocksSubmit)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={
                canOrder
                  ? t('market.checkout.placeOrderAccessibility', { seller: sellerName })
                  : t('market.checkout.signInToBuy')
              }
              testID="market-checkout-place-order"
            >
              {isPlacing || submitting ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : canOrder ? (
                <>
                  <Zap size={16} color={colors.white} strokeWidth={2.5} fill={colors.white} />
                  <Text style={styles.primaryButtonText}>{t('market.checkout.placeOrder')}</Text>
                </>
              ) : (
                <>
                  <LogIn size={16} color={colors.white} strokeWidth={2.5} />
                  <Text style={styles.primaryButtonText}>{t('market.checkout.signInToBuy')}</Text>
                </>
              )}
            </TouchableOpacity>

            {error ? (
              <Text style={styles.errorText} testID="market-checkout-error">
                {error}
              </Text>
            ) : (
              <Text style={styles.hint}>{t('market.checkout.hint')}</Text>
            )}

            <TouchableOpacity
              style={styles.fallbackLink}
              onPress={openWebsite}
              accessibilityRole="link"
              accessibilityLabel={t('market.checkout.openWebsiteAccessibility', {
                seller: sellerName,
              })}
              testID="market-checkout-website"
            >
              <ExternalLink size={14} color={colors.brandPink} strokeWidth={2.5} />
              <Text style={styles.fallbackLinkText}>
                {t('market.checkout.websiteFallback', { seller: sellerName })}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </BottomSheetScrollView>

      <CountryPickerSheet
        visible={countryPickerVisible}
        onClose={() => setCountryPickerVisible(false)}
        selectedCode={countryCode}
        onSelect={setCountryCode}
      />
    </BottomSheetModal>
  );
};

export default MarketCheckoutSheet;
