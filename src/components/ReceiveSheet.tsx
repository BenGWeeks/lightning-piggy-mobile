import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Share,
  ActivityIndicator,
  BackHandler,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { ChevronUp, ChevronDown, Check, Copy, Share2, Send } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import Toast from 'react-native-toast-message';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { decode as bolt11Decode } from 'light-bolt11-decoder';
import { useWallet } from '../contexts/WalletContext';
import { useNostr } from '../contexts/NostrContext';
import { walletLabel } from '../types/wallet';
import { colors } from '../styles/theme';
import { receiveSheetStyles as styles } from '../styles/ReceiveSheet.styles';
import { satsToFiat, formatFiat } from '../services/fiatService';
import AmountEntryScreen from './AmountEntryScreen';
import FriendPickerSheet, { PickedFriend } from './FriendPickerSheet';
import type { RootStackParamList } from '../navigation/types';

function paymentHashFromBolt11(bolt11: string): string | null {
  try {
    const decoded = bolt11Decode(bolt11);
    const section = decoded.sections?.find((s: { name: string }) => s.name === 'payment_hash') as
      | { value?: string }
      | undefined;
    return section?.value ?? null;
  } catch (error) {
    // Silent null returns would mask broken invoice generation; at
    // least surface it in dev logs so the fallback-to-balance-poll is
    // traceable.
    if (__DEV__) console.warn('[Receive] bolt11 decode failed:', error);
    return null;
  }
}

// On-chain address fetching is done via WalletContext.getReceiveAddress

interface Props {
  visible: boolean;
  onClose: () => void;
  // When set, the sheet skips the friend-picker step and DMs the generated
  // invoice (or lightning address) directly to this friend. Used when the
  // sheet is opened from inside a conversation — the friend is implicit.
  presetFriend?: PickedFriend;
  // Fired after a successful DM send with the exact text that was sent.
  // The conversation view uses this to append the outgoing message
  // locally, since the Nostr subscription only sees inbound events.
  onSent?: (payload: string) => void;
}

type Mode = 'address' | 'amount';
type Step = 'main' | 'amount';

const ReceiveSheet: React.FC<Props> = ({ visible, onClose, presetFriend, onSent }) => {
  const {
    makeInvoiceForWallet,
    refreshBalanceForWallet,
    activeWalletId,
    activeWallet,
    wallets,
    btcPrice,
    currency,
    getReceiveAddress,
    expectPayment,
    lastIncomingPayment,
  } = useWallet();
  const [capturedWalletId, setCapturedWalletId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('address');
  const [invoice, setInvoice] = useState('');
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [satsValue, setSatsValue] = useState('');
  const [step, setStep] = useState<Step>('main');
  const [onchainAddress, setOnchainAddress] = useState<string | null>(null);
  const [friendPickerOpen, setFriendPickerOpen] = useState(false);
  const [sendingToFriend, setSendingToFriend] = useState(false);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const { sendDirectMessage, contacts } = useNostr();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // No explicit snapPoints — gorhom v5's default enableDynamicSizing=true
  // gives a single content-height snap (not user-draggable).

  const selectedWalletId = capturedWalletId ?? activeWalletId;
  const selectedWallet = useMemo(
    () => wallets.find((w) => w.id === selectedWalletId) ?? null,
    [wallets, selectedWalletId],
  );
  const walletName = selectedWallet ? walletLabel(selectedWallet) : 'Wallet';
  // Lightning Address is a per-wallet field (#169). Each NWC wallet can
  // carry its own lud16 (either parsed from the NWC URL or set manually
  // in Wallet Settings) — the Receive flow must read the *selected*
  // wallet's address, not a global one that may route payments to the
  // wrong inbox.
  const lightningAddress = selectedWallet?.lightningAddress ?? null;

  const generateInvoice = useCallback(
    async (sats: number) => {
      setLoading(true);
      setPaymentReceived(false);
      try {
        const wId = capturedWalletId;
        if (!wId) return;
        const inv = await makeInvoiceForWallet(wId, sats, 'Lightning Piggy');
        setInvoice(inv);

        // Hand the invoice off to WalletContext.expectPayment, which
        // runs a 1 s lookup_invoice + balance poll for the next 3 min.
        // The poll lives in the context (not this sheet), so it keeps
        // running even if the user closes the receive sheet and wanders
        // off to Friends / Home etc. — the app-root overlay still pops
        // on settle regardless of which screen is active. Passing the
        // expected amount means the overlay shows the exact invoice
        // value rather than a balance-delta that could include prior
        // settles piled up between polls.
        const paymentHash = paymentHashFromBolt11(inv);
        if (paymentHash) {
          expectPayment(wId, paymentHash, sats);
        } else {
          // Unparseable bolt11 — fall back to a single balance refresh.
          // The WalletContext 30 s baseline poll still picks the
          // settle up eventually if the user lingers in-app.
          await refreshBalanceForWallet(wId);
        }
      } catch (error) {
        console.warn('Failed to create invoice:', error);
      } finally {
        setLoading(false);
      }
    },
    [makeInvoiceForWallet, refreshBalanceForWallet, capturedWalletId, expectPayment],
  );

  const isOnchainWallet = selectedWallet?.walletType === 'onchain';

  // Open/close the sheet — intentionally depends only on `visible`.
  // `balance` and `lightningAddress` are read for initialisation, not as reactive triggers.
  useEffect(() => {
    if (visible) {
      setCapturedWalletId(activeWalletId);
      setDropdownOpen(false);
      // Baseline is set from the first observed balance (see effect
      // below), not from the cached value here — the cache may be stale
      // if the app has been backgrounded and a previous invoice settled
      // while we weren't polling.
      setOnchainAddress(null);
      setSatsValue('');
      setInvoice('');
      setPaymentReceived(false);
      setStep('main');

      if (activeWallet?.walletType === 'onchain' && activeWalletId) {
        // On-chain wallet: fetch a receive address, default to address mode
        setMode('address');
        getReceiveAddress(activeWalletId)
          .then((addr) => setOnchainAddress(addr))
          .catch(() => {
            console.warn('Failed to fetch on-chain address');
          });
      } else if (presetFriend) {
        // "Send invoice to friend" entry point: skip straight to the
        // amount-entry screen so the user doesn't land on the address
        // tab they can't use, then a second tap on "Enter custom amount".
        setMode('amount');
        setStep('amount');
      } else if (!lightningAddress) {
        // No per-wallet LN address (#168/#169). Nothing useful to show
        // on the main view — jump directly to amount entry instead of
        // surfacing "Enter an amount to generate invoice" placeholder.
        setMode('amount');
        setStep('amount');
      } else {
        setMode('address');
      }

      bottomSheetRef.current?.present();
    } else {
      bottomSheetRef.current?.dismiss();
    }
    // Poll lives in WalletContext.expectPayment — it survives sheet
    // closure (so the user can generate an invoice, close the sheet,
    // navigate elsewhere, and still get the celebration).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Handle Android back button
  useEffect(() => {
    if (!visible) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [visible, onClose]);

  // Reset state when wallet is changed via dropdown. Must mirror the
  // skip-to-amount rule from the visible-open effect — otherwise this
  // effect races after the first sets capturedWalletId and forces step
  // back to 'main', dropping the user on the "Enter an amount to
  // generate invoice" placeholder for wallets without a lud16.
  useEffect(() => {
    if (!visible || !capturedWalletId) return;
    setOnchainAddress(null);
    setInvoice('');
    setPaymentReceived(false);
    setSatsValue('');
    if (selectedWallet?.walletType === 'onchain') {
      setMode('address');
      setStep('main');
      getReceiveAddress(capturedWalletId)
        .then((addr) => setOnchainAddress(addr))
        .catch(() => {});
    } else if (!lightningAddress) {
      setMode('amount');
      setStep('amount');
    } else {
      setMode('address');
      setStep('main');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturedWalletId]);

  // The "paymentReceived" checkmark on the QR thumbnail flips to true
  // whenever the app-root overlay fires for the wallet this sheet is
  // currently showing. We used to duplicate the baseline-detector
  // logic locally — pointlessly, since WalletContext already owns it.
  // Keyed on the event timestamp so a second receive within the same
  // sheet session still re-arms the checkmark after the user dismisses
  // the global overlay and clears `lastIncomingPayment`.
  useEffect(() => {
    if (!visible) return;
    if (
      lastIncomingPayment &&
      selectedWallet &&
      lastIncomingPayment.walletId === selectedWallet.id
    ) {
      setPaymentReceived(true);
    }
  }, [lastIncomingPayment, selectedWallet, visible]);

  const currentSats = parseInt(satsValue) || 0;

  // BIP-21 URI for on-chain: optionally include amount
  const onchainUri = onchainAddress
    ? mode === 'amount' && currentSats > 0
      ? `bitcoin:${onchainAddress}?amount=${(currentSats / 100_000_000).toFixed(8)}`
      : `bitcoin:${onchainAddress}`
    : '';

  const copyValue = isOnchainWallet
    ? mode === 'amount' && currentSats > 0
      ? onchainUri
      : onchainAddress || ''
    : mode === 'address'
      ? lightningAddress || ''
      : invoice;

  const handleCopy = async () => {
    if (copyValue) await Clipboard.setStringAsync(copyValue);
  };

  const handleShare = async () => {
    if (copyValue) {
      try {
        const shareMsg = isOnchainWallet
          ? onchainUri
          : mode === 'address'
            ? `lightning:${lightningAddress}`
            : `lightning:${invoice}`;
        await Share.share({ message: shareMsg });
      } catch {}
    }
  };

  // What we'd DM to a friend in the current state. In Address mode that's
  // the user's static lightning address (friend can pay it any time). In
  // Amount mode it's the just-generated bolt11 invoice (friend can pay it
  // once, for that exact amount). Empty during Amount-tab amount entry
  // before the debounced invoice has come back — the Copy / Share /
  // Friend buttons all disable in that window.
  const friendShareValue =
    !isOnchainWallet && mode === 'address' ? lightningAddress || '' : invoice || '';

  const handleFriendPicked = useCallback(
    async (friend: PickedFriend) => {
      if (!friendShareValue || sendingToFriend) return;
      const sharedAddress = mode === 'address';
      setSendingToFriend(true);
      setFriendPickerOpen(false);
      try {
        // Bolt11 invoices are self-identifying by their `lnbc…` prefix — no
        // URI scheme needed, and sending bare `lnbc…` matches what Damus
        // (and other Nostr clients that use nostrdb's block parser) expect
        // for cross-client interop. Lightning addresses look like plain
        // emails (`alice@example.com`), so we have to prefix them with
        // `lightning:` so the receiver can safely render a Pay button
        // without mis-classifying a regular email.
        const payload = mode === 'address' ? `lightning:${friendShareValue}` : friendShareValue;
        const result = await sendDirectMessage(friend.pubkey, payload);
        if (result.success) onSent?.(payload);
        if (!result.success) {
          Toast.show({
            type: 'error',
            text1: 'Send failed',
            text2: result.error ?? 'Could not send to friend.',
            position: 'top',
            visibilityTime: 4000,
          });
          return;
        }
        Toast.show({
          type: 'success',
          text1: sharedAddress
            ? `Lightning address sent to ${friend.name}`
            : `Invoice sent to ${friend.name}`,
          position: 'top',
          visibilityTime: 2500,
        });
        // Close this sheet and drop the user into the conversation so they
        // can see the message land and the friend's "Pay" response. When
        // opened from inside a conversation (presetFriend), we're already
        // there — just close.
        onClose();
        if (!presetFriend) {
          const contact = contacts.find((c) => c.pubkey === friend.pubkey);
          navigation.navigate('Conversation', {
            pubkey: friend.pubkey,
            name: friend.name,
            picture: friend.picture,
            lightningAddress: contact?.profile?.lud16 ?? friend.lightningAddress,
          });
        }
      } finally {
        setSendingToFriend(false);
      }
    },
    [
      friendShareValue,
      mode,
      sendingToFriend,
      sendDirectMessage,
      contacts,
      navigation,
      onClose,
      presetFriend,
      onSent,
    ],
  );

  const handleSendToFriend = useCallback(() => {
    if (!friendShareValue) return;
    if (presetFriend) {
      handleFriendPicked(presetFriend);
      return;
    }
    setFriendPickerOpen(true);
  }, [friendShareValue, presetFriend, handleFriendPicked]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  if (!visible) return null;

  return (
    <>
      <BottomSheetModal
        ref={bottomSheetRef}
        onChange={handleSheetChange}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
      >
        <BottomSheetView style={styles.content}>
          {/* No TouchableWithoutFeedback-with-Keyboard.dismiss wrapper here
           *  per TROUBLESHOOTING.adoc rule (6): it interferes with the
           *  sheet's keyboard handling AND, under the New Architecture,
           *  swallows UiAutomator/Maestro accessibility clicks that should
           *  reach the inner Pressable/TouchableOpacity testIDs (caused
           *  issue #106 — Maestro tap on `receive-send-to-friend` reported
           *  COMPLETED but never dispatched onPress). The keyboard can be
           *  dismissed naturally by tapping any of the buttons or the
           *  hardware back key. */}
          {step === 'amount' ? (
            <AmountEntryScreen
              initialSats={currentSats}
              title="Custom amount"
              confirmLabel="Generate invoice"
              onBack={() => setStep('main')}
              onConfirm={(sats) => {
                setSatsValue(String(sats));
                setStep('main');
                // User confirmed — generate the invoice straight away.
                // On-chain skips this: the BIP-21 URI is derived from
                // currentSats so the QR refreshes on its own.
                if (sats > 0 && !isOnchainWallet) generateInvoice(sats);
              }}
            />
          ) : (
            <View style={styles.innerContent}>
              <Text style={styles.title}>Receive</Text>

              {/* Wallet selector */}
              {wallets.filter((w) => w.isConnected || w.walletType === 'onchain').length > 1 ? (
                <View style={styles.walletDropdownRow}>
                  <Text style={styles.walletLabel}>To:</Text>
                  <View style={styles.walletDropdownWrapper}>
                    <TouchableOpacity
                      style={styles.walletDropdown}
                      onPress={() => setDropdownOpen(!dropdownOpen)}
                    >
                      <Text style={styles.walletDropdownText}>{walletName}</Text>
                      {dropdownOpen ? (
                        <ChevronUp size={16} color={colors.white} />
                      ) : (
                        <ChevronDown size={16} color={colors.white} />
                      )}
                    </TouchableOpacity>
                    {dropdownOpen && (
                      <View style={styles.walletDropdownMenu}>
                        {wallets
                          .filter((w) => w.isConnected || w.walletType === 'onchain')
                          .map((w) => (
                            <TouchableOpacity
                              key={w.id}
                              style={[
                                styles.walletDropdownItem,
                                capturedWalletId === w.id && styles.walletDropdownItemActive,
                              ]}
                              onPress={() => {
                                setCapturedWalletId(w.id);
                                setDropdownOpen(false);
                              }}
                            >
                              <Text
                                style={[
                                  styles.walletDropdownItemText,
                                  capturedWalletId === w.id && styles.walletDropdownItemTextActive,
                                ]}
                              >
                                {walletLabel(w)}
                              </Text>
                            </TouchableOpacity>
                          ))}
                      </View>
                    )}
                  </View>
                </View>
              ) : (
                <Text style={styles.walletLabel}>To: {walletName}</Text>
              )}

              {/* Mode tabs — show for on-chain wallets and NWC wallets with lightning address */}
              {isOnchainWallet || lightningAddress ? (
                <View style={styles.tabRow}>
                  <TouchableOpacity
                    style={[styles.tab, mode === 'address' && styles.tabActive]}
                    onPress={() => setMode('address')}
                    testID="receive-tab-address"
                  >
                    <Text style={[styles.tabText, mode === 'address' && styles.tabTextActive]}>
                      Address
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.tab, mode === 'amount' && styles.tabActive]}
                    onPress={() => setMode('amount')}
                    testID="receive-tab-amount"
                  >
                    <Text style={[styles.tabText, mode === 'amount' && styles.tabTextActive]}>
                      Amount
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* QR Code */}
              <View style={styles.qrContainer}>
                {isOnchainWallet && onchainAddress && (mode === 'address' || currentSats > 0) ? (
                  <View>
                    <QRCode value={onchainUri} size={200} />
                    {paymentReceived && (
                      <View style={styles.checkmark}>
                        <Text style={styles.checkmarkText}>{'\u2713'}</Text>
                      </View>
                    )}
                  </View>
                ) : isOnchainWallet && mode === 'amount' && currentSats === 0 ? (
                  <Text style={styles.noInvoice}>Enter an amount to generate QR code</Text>
                ) : mode === 'address' && lightningAddress ? (
                  <View>
                    <QRCode value={`lightning:${lightningAddress}`} size={200} />
                    {paymentReceived && (
                      <View style={styles.checkmark}>
                        <Check size={28} color={colors.white} />
                      </View>
                    )}
                  </View>
                ) : mode === 'amount' && loading ? (
                  <ActivityIndicator size="large" color={colors.brandPink} />
                ) : mode === 'amount' && invoice ? (
                  <View>
                    <QRCode value={invoice} size={200} />
                    {paymentReceived && (
                      <View style={styles.checkmark}>
                        <Check size={28} color={colors.white} />
                      </View>
                    )}
                  </View>
                ) : (
                  <Text style={styles.noInvoice}>
                    {mode === 'address'
                      ? 'No lightning address set'
                      : 'Enter an amount to generate invoice'}
                  </Text>
                )}
              </View>

              <Text style={styles.qrLabel}>
                {isOnchainWallet && onchainAddress && !(mode === 'amount' && currentSats > 0) ? (
                  <>
                    <Text style={styles.addressHighlight}>{onchainAddress.slice(0, 6)}</Text>
                    {onchainAddress.slice(6, -6)}
                    <Text style={styles.addressHighlight}>{onchainAddress.slice(-6)}</Text>
                  </>
                ) : isOnchainWallet ? (
                  mode === 'amount' && currentSats > 0 ? (
                    `${currentSats.toLocaleString()} sats`
                  ) : (
                    'Loading address...'
                  )
                ) : mode === 'address' ? (
                  lightningAddress
                ) : (
                  'Lightning invoice'
                )}
              </Text>
              {mode === 'amount' && invoice ? (
                <Text style={styles.invoiceText} numberOfLines={2}>
                  {invoice}
                </Text>
              ) : null}

              {presetFriend ? (
                <View style={styles.buttonRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionButton,
                      styles.actionButtonPrimary,
                      !friendShareValue && styles.actionButtonDisabled,
                      pressed && { opacity: 0.7 },
                    ]}
                    onPress={handleSendToFriend}
                    disabled={!friendShareValue || sendingToFriend}
                    accessibilityLabel={`Send to ${presetFriend.name}`}
                    testID="receive-send-to-friend"
                  >
                    {sendingToFriend ? (
                      <ActivityIndicator color={colors.white} />
                    ) : (
                      <>
                        <Send size={20} color={colors.white} />
                        <Text style={[styles.actionButtonText, styles.actionButtonTextPrimary]}>
                          Send to {presetFriend.name}
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              ) : (
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.actionButton, !copyValue && styles.actionButtonDisabled]}
                    onPress={handleCopy}
                    disabled={!copyValue}
                  >
                    <Copy size={20} color={colors.brandPink} />
                    <Text style={styles.actionButtonText}>Copy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, !copyValue && styles.actionButtonDisabled]}
                    onPress={handleShare}
                    disabled={!copyValue}
                  >
                    <Text style={styles.actionButtonText}>Share</Text>
                    <Share2 size={20} color={colors.brandPink} />
                  </TouchableOpacity>
                  {!isOnchainWallet ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.actionButton,
                        !friendShareValue && styles.actionButtonDisabled,
                        pressed && { opacity: 0.7 },
                      ]}
                      onPress={() => {
                        if (__DEV__) console.log('[ReceiveSheet] Friend Pressable FIRED');
                        handleSendToFriend();
                      }}
                      disabled={!friendShareValue}
                      accessibilityLabel="Send to a friend"
                      testID="receive-send-to-friend"
                    >
                      <Text style={styles.actionButtonText}>Friend</Text>
                      <Send size={20} color={colors.brandPink} />
                    </Pressable>
                  ) : null}
                </View>
              )}

              {/* Amount summary / Enter-custom-amount CTA — matches Figma
               *  57-2276 (no amount) and 57-2515 (with amount). Hidden for
               *  the presetFriend flow since that sheet is a single-shot
               *  send-invoice-to-a-friend operation with its own CTA. */}
              {!presetFriend && mode === 'amount' ? (
                currentSats > 0 && (invoice || (isOnchainWallet && onchainAddress)) ? (
                  <View style={styles.amountSummary}>
                    <View style={styles.amountSummaryLine}>
                      <Text style={styles.amountSummaryValue}>{currentSats.toLocaleString()}</Text>
                      <Text style={styles.amountSummaryUnit}>SATS</Text>
                    </View>
                    {btcPrice ? (
                      <Text style={styles.amountSummaryFiat}>
                        Aprox {formatFiat(satsToFiat(currentSats, btcPrice), currency)}
                      </Text>
                    ) : null}
                    <TouchableOpacity
                      style={styles.changeAmountButton}
                      onPress={() => setStep('amount')}
                      testID="receive-change-amount"
                      accessibilityLabel="Change amount"
                    >
                      <Text style={styles.changeAmountText}>Change amount</Text>
                    </TouchableOpacity>
                  </View>
                ) : !loading ? (
                  <TouchableOpacity
                    style={styles.enterAmountButton}
                    onPress={() => setStep('amount')}
                    testID="receive-enter-custom-amount"
                    accessibilityLabel="Enter custom amount"
                  >
                    <Text style={styles.enterAmountText}>Enter custom amount</Text>
                  </TouchableOpacity>
                ) : null
              ) : null}
            </View>
          )}
        </BottomSheetView>
      </BottomSheetModal>
      <FriendPickerSheet
        visible={friendPickerOpen}
        onClose={() => setFriendPickerOpen(false)}
        onSelect={handleFriendPicked}
        title="Send invoice to a friend"
        subtitle="They'll get an encrypted Nostr DM with a Pay button."
      />
    </>
  );
};

export default ReceiveSheet;
