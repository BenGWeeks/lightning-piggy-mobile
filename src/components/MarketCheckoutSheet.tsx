import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Zap, Plus, Minus, Check, ExternalLink, LogIn } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createMarketCheckoutSheetStyles } from '../styles/MarketCheckoutSheet.styles';
import { useMarketCheckout } from '../hooks/useMarketCheckout';
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

  // --- Country-first shipping (#948 Option A) ---
  const shipping = useShippingOptions(visible ? vendorPubkey : null, visible);
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const [selectedCoordinate, setSelectedCoordinate] = useState<string | null>(null);
  // BTC spot price per fiat currency the options quote in (null = fetch
  // failed → the option can't be priced in sats and submit stays blocked).
  const [btcPriceByCurrency, setBtcPriceByCurrency] = useState<Map<string, number | null>>(
    new Map(),
  );

  useEffect(() => {
    if (visible) {
      setQuantity(1);
      setImageFailed(false);
      // Pre-select the device-locale country (spec: user can change it).
      setCountryCode(deviceCountryCode());
      setSelectedCoordinate(null);
      reset();
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible, reset]);

  // The merchant publishes shipping options ⇔ the country-first flow is on.
  // Zero published options (a digital-goods seller) skips the section — the
  // pre-shipping checkout behaviour, unchanged.
  const hasShipping = shipping.status === 'ready' && shipping.options.length > 0;

  // Fetch a BTC spot price once per distinct fiat currency the options use.
  useEffect(() => {
    if (!hasShipping) return;
    const fiat = new Set(
      shipping.options
        .map((o) => o.currency)
        .filter((c) => c && c !== 'SATS' && c !== 'SAT' && c !== 'BTC'),
    );
    for (const currency of fiat) {
      if (btcPriceByCurrency.has(currency)) continue;
      getBtcPrice(currency)
        .then((price) => {
          setBtcPriceByCurrency((prev) => new Map(prev).set(currency, price));
        })
        .catch(() => {
          setBtcPriceByCurrency((prev) => new Map(prev).set(currency, null));
        });
    }
    // btcPriceByCurrency intentionally omitted: the `has` guard already
    // prevents refetch loops, and depending on it would refire per result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShipping, shipping.options]);

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
        shippingCostSats(amount, option.currency, btcPriceByCurrency.get(option.currency) ?? null),
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

  // Submit gate (spec §6): while options are loading/unloadable we can't know
  // whether shipping is required, so block; once options exist, require a
  // country + a compatible option with a priceable sats cost.
  const shippingBlocksSubmit =
    shipping.status === 'loading' ||
    shipping.status === 'error' ||
    (hasShipping && (!countryCode || !selectedOption || selectedShippingSats === null));

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const subtotalSats = product.priceSats * quantity;
  const totalSats = orderTotalWithShippingSats(subtotalSats, selectedShippingSats ?? 0);
  const hasThumb = product.image.length > 0 && !imageFailed;

  const handlePlace = useCallback(async () => {
    if (!canOrder) {
      onRequestSignIn();
      return;
    }
    if (shippingBlocksSubmit) return;
    try {
      await placeOrder({
        vendorPubkey,
        dTag: product.id,
        priceSats: product.priceSats,
        quantity,
        shipping:
          hasShipping && selectedOption && selectedShippingSats !== null
            ? {
                coordinate: selectedOption.coordinate,
                costSats: selectedShippingSats,
                title: selectedOption.title,
              }
            : undefined,
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
      enablePanDownToClose
      enableDynamicSizing
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handle}
      onDismiss={onClose}
    >
      <BottomSheetView style={styles.container} testID="market-checkout-sheet">
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
              <Text style={styles.primaryButtonText}>{t('market.checkout.goToChat')}</Text>
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
                  disabled={quantity <= 1}
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
                  disabled={quantity >= MAX_QTY}
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
                onOpenCountryPicker={() => setCountryPickerVisible(true)}
                selectedCoordinate={selectedCoordinate}
                onSelectOption={setSelectedCoordinate}
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
                    {t('market.sats', { amount: subtotalSats.toLocaleString() })}
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
                  {t('market.sats', { amount: totalSats.toLocaleString() })}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                (isPlacing || (canOrder && shippingBlocksSubmit)) && styles.primaryButtonDisabled,
              ]}
              onPress={handlePlace}
              disabled={isPlacing || (canOrder && shippingBlocksSubmit)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={
                canOrder
                  ? t('market.checkout.placeOrderAccessibility', { seller: sellerName })
                  : t('market.checkout.signInToBuy')
              }
              testID="market-checkout-place-order"
            >
              {isPlacing ? (
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
      </BottomSheetView>

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
