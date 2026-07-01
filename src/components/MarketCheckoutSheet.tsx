import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Zap, Plus, Minus, Check, ExternalLink, LogIn } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMarketCheckoutSheetStyles } from '../styles/MarketCheckoutSheet.styles';
import { useMarketCheckout } from '../hooks/useMarketCheckout';
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
  const styles = useMemo(() => createMarketCheckoutSheetStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  const { status, error, isPlacing, canOrder, placeOrder, reset } = useMarketCheckout();

  const [quantity, setQuantity] = useState(1);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (visible) {
      setQuantity(1);
      setImageFailed(false);
      reset();
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible, reset]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const totalSats = product.priceSats * quantity;
  const hasThumb = product.image.length > 0 && !imageFailed;

  const handlePlace = useCallback(async () => {
    if (!canOrder) {
      onRequestSignIn();
      return;
    }
    try {
      await placeOrder({
        vendorPubkey,
        dTag: product.id,
        priceSats: product.priceSats,
        quantity,
      });
      Toast.show({
        type: 'success',
        text1: 'Order placed',
        text2: `Waiting for ${sellerName} to send an invoice…`,
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
            <Text style={styles.sentTitle}>Order placed</Text>
            <Text style={styles.sentBody}>
              Your order was sent to {sellerName}. When they send a Lightning invoice it&apos;ll
              appear as a payable order in your chat with them.
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleGoToConversation}
              accessibilityRole="button"
              accessibilityLabel={`Open your conversation with ${sellerName}`}
              testID="market-checkout-goto-conversation"
            >
              <Zap size={16} color={colors.white} strokeWidth={2.5} fill={colors.white} />
              <Text style={styles.primaryButtonText}>Go to chat to pay</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.title}>Buy from {sellerName}</Text>

            <View style={styles.productRow}>
              {hasThumb ? (
                <Image
                  source={{ uri: product.image }}
                  style={styles.thumb}
                  resizeMode="cover"
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
                <Text style={styles.productSeller}>from {sellerName}</Text>
                <Text style={styles.unitPrice}>
                  {product.priceSats.toLocaleString()} sats each · {product.priceFiatLabel}
                </Text>
              </View>
            </View>

            <View style={styles.row}>
              <Text style={styles.rowLabel}>Quantity</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={[styles.stepButton, quantity <= 1 && styles.stepButtonDisabled]}
                  onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                  accessibilityRole="button"
                  accessibilityLabel="Decrease quantity"
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
                  accessibilityLabel="Increase quantity"
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

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <View style={styles.totalValue}>
                <Zap size={16} color={colors.brandPink} strokeWidth={2.5} fill={colors.brandPink} />
                <Text style={styles.totalSats} testID="market-checkout-total">
                  {totalSats.toLocaleString()} sats
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, isPlacing && styles.primaryButtonDisabled]}
              onPress={handlePlace}
              disabled={isPlacing}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={canOrder ? `Place order with ${sellerName}` : 'Sign in to buy'}
              testID="market-checkout-place-order"
            >
              {isPlacing ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : canOrder ? (
                <>
                  <Zap size={16} color={colors.white} strokeWidth={2.5} fill={colors.white} />
                  <Text style={styles.primaryButtonText}>Place order</Text>
                </>
              ) : (
                <>
                  <LogIn size={16} color={colors.white} strokeWidth={2.5} />
                  <Text style={styles.primaryButtonText}>Sign in to buy</Text>
                </>
              )}
            </TouchableOpacity>

            {error ? (
              <Text style={styles.errorText} testID="market-checkout-error">
                {error}
              </Text>
            ) : (
              <Text style={styles.hint}>
                Your order is sent privately (gift-wrapped) to the seller, who replies with a
                Lightning invoice you pay in-app.
              </Text>
            )}

            <TouchableOpacity
              style={styles.fallbackLink}
              onPress={openWebsite}
              accessibilityRole="link"
              accessibilityLabel={`Open ${sellerName} website instead`}
              testID="market-checkout-website"
            >
              <ExternalLink size={14} color={colors.brandPink} strokeWidth={2.5} />
              <Text style={styles.fallbackLinkText}>Prefer the website? Open {sellerName}</Text>
            </TouchableOpacity>
          </>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
};

export default MarketCheckoutSheet;
