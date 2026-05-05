import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import * as SecureStore from 'expo-secure-store';
import * as Clipboard from 'expo-clipboard';
import Toast from './BrandedToast';
import { satsToFiatString } from '../services/fiatService';
import { useWallet } from '../contexts/WalletContext';
import { useNostr } from '../contexts/NostrContext';
import * as swapRecoveryService from '../services/swapRecoveryService';
import * as nwcService from '../services/nwcService';
import { createTransactionDetailSheetStyles } from '../styles/TransactionDetailSheet.styles';
import FeedbackSheet from './FeedbackSheet';
import NostrLoginSheet from './NostrLoginSheet';
import { createDmSender } from '../utils/nostrDm';
import { truncateMiddle, formatFriendlyDateTime } from '../utils/format';
import { getTxCategory } from '../utils/txCategory';
import TransactionTypeIcon from './TransactionTypeIcon';
import type { ZapCounterpartyInfo } from '../types/wallet';
import { useThemeColors } from '../contexts/ThemeContext';
import { BOLTZ_SUPPORT_NPUB, dmRecipient } from '../constants/npubs';
import { Copy, Zap, MessageCircle } from 'lucide-react-native';

export interface TransactionDetailData {
  type: 'incoming' | 'outgoing' | string;
  amount: number;
  description?: string;
  created_at?: number | null;
  settled_at?: number | null;
  blockHeight?: number | null;
  /** Also set for Boltz claim txs, not just plain on-chain. */
  txid?: string;
  paymentHash?: string;
  preimage?: string;
  invoice?: string;
  feesSats?: number;
  swapId?: string;
  zapCounterparty?: ZapCounterpartyInfo | null;
}

export interface CounterpartyContact {
  pubkey: string;
  name: string;
  picture: string | null;
  banner: string | null;
  nip05: string | null;
  lightningAddress: string | null;
  source: 'nostr';
}

function zapCounterpartyName(sender: ZapCounterpartyInfo): string {
  if (sender.anonymous) return 'Anonymous';
  const p = sender.profile;
  return p?.displayName || p?.name || 'Nostr user';
}

interface Props {
  visible: boolean;
  tx: TransactionDetailData | null;
  onClose: () => void;
  /** Raised when the user taps the sender/recipient card. The parent
   *  should close this sheet and present its own ContactProfileSheet —
   *  rendering the child sheet inside this one stacks a second modal on
   *  top of an already-visible modal, which looks crowded and fights
   *  @gorhom's modal dismissal semantics. */
  onCounterpartyPress?: (contact: CounterpartyContact) => void;
  /** Fired when the user taps the Zap icon in the recipient/sender card. */
  onZapCounterparty?: (contact: CounterpartyContact) => void;
  /** Fired when the user taps the Message icon in the recipient/sender card. */
  onMessageCounterparty?: (contact: CounterpartyContact) => void;
}

type BoltzSwapView = {
  status: string;
  lockupTxId?: string;
  claimable: boolean;
  terminalSuccess: boolean;
  terminalFailure: boolean;
};

const BOLTZ_API = 'https://api.boltz.exchange/v2';

const TransactionDetailSheet: React.FC<Props> = ({
  visible,
  tx,
  onClose,
  onCounterpartyPress,
  onZapCounterparty,
  onMessageCounterparty,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createTransactionDetailSheetStyles(colors), [colors]);
  const CopyRow: React.FC<{
    label: string;
    value: string;
    onCopy: (label: string, value: string) => void;
  }> = ({ label, value, onCopy }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onCopy(label, value)}
      accessibilityLabel={`Copy ${label.toLowerCase()}`}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValueWrap}>
        <Text style={[styles.rowValue, styles.rowValueMono]} numberOfLines={1}>
          {truncateMiddle(value)}
        </Text>
        <Copy size={14} color={colors.textSupplementary} />
      </View>
    </TouchableOpacity>
  );
  const { btcPrice, currency, activeWallet } = useWallet();
  const { isLoggedIn, signerType, sendDirectMessage, contacts } = useNostr();
  const sheetRef = useRef<BottomSheetModal>(null);
  const [swap, setSwap] = useState<BoltzSwapView | null>(null);
  const [resolvedSwapId, setResolvedSwapId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [supportSheetOpen, setSupportSheetOpen] = useState(false);
  const [loginSheetOpen, setLoginSheetOpen] = useState(false);
  // Some NWC backends (notably LNbits) omit preimage/invoice from
  // list_transactions; fill them in via lookupInvoice when the sheet opens.
  const [enrichment, setEnrichment] = useState<{ preimage?: string; invoice?: string }>({});

  useEffect(() => {
    if (visible) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [visible]);

  useEffect(() => {
    setEnrichment({});
    if (!visible || !tx) return;
    // Some NWC backends return transactions whose payment_hash is null /
    // truncated / otherwise not a 64-char hex string; skip those outright
    // so we don't kick off a lookup the backend will reject (#98).
    if (!nwcService.isValidPaymentHash(tx.paymentHash)) return;
    if (tx.preimage && tx.invoice) return;
    if (!activeWallet || activeWallet.walletType === 'onchain') return;
    const paymentHash = tx.paymentHash;
    let cancelled = false;
    (async () => {
      const result = await nwcService.lookupInvoice(activeWallet.id, paymentHash);
      if (!cancelled && result) setEnrichment(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, tx, activeWallet]);

  // Match Boltz-minted invoice memos ("Send to BTC address" /
  // "Receive from BTC address") — settled swaps don't carry tx.swapId.
  const isBoltzSwap = useMemo(() => {
    if (!tx) return false;
    if (tx.swapId) return true;
    if (tx.description) {
      if (/boltz swap/i.test(tx.description)) return true;
      if (/send to btc|send to bitcoin/i.test(tx.description)) return true;
      if (/receive from btc|receive from bitcoin/i.test(tx.description)) return true;
    }
    return false;
  }, [tx]);

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      setSwap(null);
      setResolvedSwapId(null);
      if (!tx || !isBoltzSwap) return;

      let swapId: string | undefined = tx.swapId;
      if (!swapId) {
        try {
          const indexRaw = await SecureStore.getItemAsync('boltz_swap_index');
          if (indexRaw) {
            const ids = JSON.parse(indexRaw) as string[];
            swapId = ids[ids.length - 1];
          }
        } catch {}
      }
      if (!swapId || cancelled) return;
      setResolvedSwapId(swapId);

      try {
        const res = await fetch(`${BOLTZ_API}/swap/${swapId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const status: string = data.status ?? 'unknown';
        const claimable = status === 'transaction.mempool' || status === 'transaction.confirmed';
        const terminalSuccess = status === 'invoice.settled' || status === 'transaction.claimed';
        const terminalFailure =
          status === 'swap.expired' ||
          status === 'transaction.refunded' ||
          status === 'transaction.failed' ||
          status === 'invoice.expired';
        if (!cancelled) {
          setSwap({
            status,
            lockupTxId: data.transaction?.id,
            claimable,
            terminalSuccess,
            terminalFailure,
          });
        }
      } catch {
        // Network failure — don't show swap section rather than faking data.
      }
    };
    resolve();
    return () => {
      cancelled = true;
    };
  }, [tx, isBoltzSwap]);

  const handleRetryClaim = useCallback(async () => {
    setRetrying(true);
    try {
      await swapRecoveryService.recoverPendingSwaps();
      Toast.show({
        type: 'info',
        text1: 'Retry kicked off',
        text2: 'Any claimable swaps are being re-broadcast.',
        position: 'top',
        visibilityTime: 6000,
      });
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: 'Retry failed',
        text2: e instanceof Error ? e.message : String(e),
        position: 'top',
        visibilityTime: 8000,
      });
    } finally {
      setRetrying(false);
    }
  }, []);

  const copyValue = useCallback(async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    Toast.show({
      type: 'info',
      text1: `${label} copied`,
      position: 'top',
      visibilityTime: 2000,
    });
  }, []);

  const renderBackdrop = useCallback(
    (p: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...p} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    [],
  );

  const statusBadge = useMemo(() => {
    if (!tx) return null;
    const pending = !tx.settled_at && !tx.blockHeight;
    if (swap?.terminalFailure) return { style: styles.badgeFailed, text: `Swap: ${swap.status}` };
    if (swap?.terminalSuccess) return { style: styles.badgeConfirmed, text: 'Swap complete' };
    if (swap?.claimable) return { style: styles.badgeInfo, text: 'Claim available' };
    if (swap) return { style: styles.badgeInfo, text: `Swap: ${swap.status}` };
    if (pending) return { style: styles.badgePending, text: 'Pending' };
    return { style: styles.badgeConfirmed, text: 'Confirmed' };
  }, [tx, swap]);

  const effectiveSwapId = tx?.swapId || resolvedSwapId || null;

  const boltzInitialMessage = useMemo(() => {
    if (!tx) return '';
    const isIncoming = tx.type === 'incoming';
    const amount = Math.abs(tx.amount);
    const dateTs = tx.settled_at || tx.created_at;
    const dateStr = dateTs ? formatFriendlyDateTime(dateTs) : null;
    const lines: string[] = ['Hi Boltz support,', ''];
    lines.push('I have a question about this transaction:');
    if (effectiveSwapId) lines.push(`• Swap ID: ${effectiveSwapId}`);
    if (swap?.status) lines.push(`• Swap status: ${swap.status}`);
    if (swap?.lockupTxId) lines.push(`• Lockup tx: ${swap.lockupTxId}`);
    if (tx.txid) lines.push(`• On-chain tx: ${tx.txid}`);
    if (tx.paymentHash) lines.push(`• Payment hash: ${tx.paymentHash}`);
    lines.push(`• Direction: ${isIncoming ? 'received' : 'sent'}`);
    lines.push(`• Amount: ${amount.toLocaleString()} sats`);
    if (dateStr) lines.push(`• Time: ${dateStr}`);
    lines.push('', 'Details:');
    lines.push('(describe the issue)');
    return lines.join('\n');
  }, [tx, effectiveSwapId, swap]);

  if (!tx) return null;

  const isIncoming = tx.type === 'incoming';
  const amount = Math.abs(tx.amount);
  const fiat = satsToFiatString(amount, btcPrice, currency);
  const dateTs = tx.settled_at || tx.created_at;
  const dateStr = dateTs ? formatFriendlyDateTime(dateTs) : null;
  const preimage = tx.preimage || enrichment.preimage;
  const invoice = tx.invoice || enrichment.invoice;

  const zapCounterparty = tx.zapCounterparty ?? null;
  const counterpartyNpubDisplay = zapCounterparty?.profile?.npub
    ? `${zapCounterparty.profile.npub.slice(0, 14)}…${zapCounterparty.profile.npub.slice(-6)}`
    : null;
  // NIP-57 receipts carry name / picture / nip05 but not the banner or
  // the lud16 lightning address — fall back to the kind-0 profile cached
  // from the contact list so the sheet shown from Transactions matches
  // the richer one shown from Friends.
  const counterpartyCachedProfile = zapCounterparty?.pubkey
    ? (contacts.find((c) => c.pubkey === zapCounterparty.pubkey)?.profile ?? null)
    : null;
  const counterpartyContact: CounterpartyContact | null =
    zapCounterparty && !zapCounterparty.anonymous && zapCounterparty.pubkey
      ? {
          pubkey: zapCounterparty.pubkey,
          name: zapCounterpartyName(zapCounterparty),
          picture: zapCounterparty.profile?.picture ?? counterpartyCachedProfile?.picture ?? null,
          banner: counterpartyCachedProfile?.banner ?? null,
          nip05: zapCounterparty.profile?.nip05 ?? counterpartyCachedProfile?.nip05 ?? null,
          lightningAddress: counterpartyCachedProfile?.lud16 ?? null,
          source: 'nostr' as const,
        }
      : null;

  return (
    <>
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={['70%']}
        enablePanDownToClose
        onDismiss={onClose}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.handleIndicator}
      >
        <BottomSheetView style={styles.content}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <TransactionTypeIcon category={getTxCategory(tx)} size={56} />
            </View>
            <Text
              style={[
                styles.headerAmount,
                isIncoming ? styles.amountIncoming : styles.amountOutgoing,
              ]}
            >
              {isIncoming ? '+' : '-'}
              {amount.toLocaleString()} sats
            </Text>
            {fiat ? <Text style={styles.headerFiat}>{fiat}</Text> : null}
            {tx.description ? <Text style={styles.headerLabel}>{tx.description}</Text> : null}
            {statusBadge ? (
              <View style={[styles.badge, statusBadge.style]}>
                <Text style={styles.badgeText}>{statusBadge.text}</Text>
              </View>
            ) : null}
          </View>

          {zapCounterparty ? (
            <>
              <Text style={styles.senderLabel}>{isIncoming ? 'Sender' : 'Recipient'}</Text>
              <TouchableOpacity
                style={styles.senderCard}
                onPress={() => {
                  if (!counterpartyContact) return;
                  onClose();
                  onCounterpartyPress?.(counterpartyContact);
                }}
                disabled={!counterpartyContact || !onCounterpartyPress}
                accessibilityLabel={`${isIncoming ? 'Sender' : 'Recipient'} ${zapCounterpartyName(zapCounterparty)}`}
                testID="tx-detail-sender-card"
              >
                {zapCounterparty.profile?.picture ? (
                  <Image
                    source={{ uri: zapCounterparty.profile.picture }}
                    style={styles.senderAvatar}
                    cachePolicy="disk"
                    contentFit="cover"
                  />
                ) : (
                  <View style={styles.senderAvatarPlaceholder}>
                    <Text style={{ fontSize: 22, color: colors.textSupplementary }}>
                      {zapCounterparty.anonymous ? '?' : '⚡'}
                    </Text>
                  </View>
                )}
                <View style={styles.senderTextCol}>
                  <Text style={styles.senderName} numberOfLines={1}>
                    {zapCounterpartyName(zapCounterparty)}
                  </Text>
                  {counterpartyNpubDisplay ? (
                    <Text style={styles.senderNpub} numberOfLines={1}>
                      {counterpartyNpubDisplay}
                    </Text>
                  ) : null}
                </View>
                {counterpartyContact ? (
                  <View style={styles.senderActions}>
                    {onZapCounterparty && counterpartyContact.lightningAddress ? (
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          onClose();
                          onZapCounterparty(counterpartyContact);
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.senderActionIcon}
                        accessibilityLabel={`Zap ${counterpartyContact.name}`}
                        testID="tx-detail-zap"
                      >
                        <Zap size={20} color={colors.white} fill={colors.white} />
                      </TouchableOpacity>
                    ) : null}
                    {onMessageCounterparty ? (
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          onClose();
                          onMessageCounterparty(counterpartyContact);
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.senderActionIcon}
                        accessibilityLabel={`Message ${counterpartyContact.name}`}
                        testID="tx-detail-message"
                      >
                        <MessageCircle size={20} color={colors.white} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
              </TouchableOpacity>
              {zapCounterparty.comment ? (
                <Text style={styles.senderComment}>{zapCounterparty.comment}</Text>
              ) : null}
            </>
          ) : null}

          {dateStr ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Date</Text>
              <Text style={styles.rowValue}>{dateStr}</Text>
            </View>
          ) : null}

          {tx.blockHeight ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Block</Text>
              <Text style={styles.rowValue}>{tx.blockHeight.toLocaleString()}</Text>
            </View>
          ) : null}

          {typeof tx.feesSats === 'number' && tx.feesSats > 0 ? (
            <TouchableOpacity
              style={styles.row}
              onPress={() => copyValue('Fee', `${tx.feesSats} sats`)}
              accessibilityLabel="Copy fee"
            >
              <Text style={styles.rowLabel}>Fee</Text>
              <View style={styles.rowValueWrap}>
                <Text style={styles.rowValue}>{tx.feesSats.toLocaleString()} sats</Text>
                <Copy size={14} color={colors.textSupplementary} />
              </View>
            </TouchableOpacity>
          ) : null}

          {tx.txid ? <CopyRow label="On-chain tx" value={tx.txid} onCopy={copyValue} /> : null}

          {swap?.lockupTxId ? (
            <CopyRow label="Lockup tx" value={swap.lockupTxId} onCopy={copyValue} />
          ) : null}

          {tx.paymentHash ? (
            <CopyRow label="Payment hash" value={tx.paymentHash} onCopy={copyValue} />
          ) : null}

          {preimage ? <CopyRow label="Preimage" value={preimage} onCopy={copyValue} /> : null}

          {invoice ? <CopyRow label="Invoice" value={invoice} onCopy={copyValue} /> : null}

          <View style={styles.actions}>
            {swap?.claimable ? (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleRetryClaim}
                disabled={retrying}
                accessibilityLabel="Retry claim"
              >
                {retrying ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Retry claim</Text>
                )}
              </TouchableOpacity>
            ) : null}
            {tx.txid || swap?.lockupTxId ? (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => {
                  const id = tx.txid || swap?.lockupTxId;
                  if (id) Linking.openURL(`https://mempool.space/tx/${id}`);
                }}
                accessibilityLabel="View on mempool.space"
              >
                <Text style={styles.secondaryButtonText}>View on mempool.space</Text>
              </TouchableOpacity>
            ) : null}
            {isBoltzSwap ? (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setSupportSheetOpen(true)}
                accessibilityLabel="Contact Boltz support"
                testID="contact-boltz-support"
              >
                <Text style={styles.secondaryButtonText}>Contact Boltz support</Text>
              </TouchableOpacity>
            ) : null}
            {swap?.claimable ? (
              <Text style={styles.info}>
                Retry re-runs the swap recovery service, which will re-broadcast the claim
                transaction from persisted swap state.
              </Text>
            ) : null}
          </View>
        </BottomSheetView>
      </BottomSheetModal>
      <FeedbackSheet
        visible={supportSheetOpen}
        onClose={() => setSupportSheetOpen(false)}
        onSend={createDmSender(dmRecipient(BOLTZ_SUPPORT_NPUB), sendDirectMessage)}
        isLoggedIn={isLoggedIn}
        signerType={signerType}
        onLoginPress={() => setLoginSheetOpen(true)}
        title="Contact Boltz support"
        subtitle="Your message will be sent as an encrypted Nostr DM to the Boltz team."
        initialMessage={boltzInitialMessage}
        messagePrefix="[Boltz Support]"
        successTitle="Message sent"
        successMessage="Boltz support will reply via Nostr DM. Check your usual Nostr client for the response."
      />
      <NostrLoginSheet visible={loginSheetOpen} onClose={() => setLoginSheetOpen(false)} />
    </>
  );
};

export default TransactionDetailSheet;
