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
import Toast from 'react-native-toast-message';
import { satsToFiatString } from '../services/fiatService';
import { useWallet } from '../contexts/WalletContext';
import { useNostr } from '../contexts/NostrContext';
import * as swapRecoveryService from '../services/swapRecoveryService';
import * as nwcService from '../services/nwcService';
import { transactionDetailSheetStyles as styles } from '../styles/TransactionDetailSheet.styles';
import FeedbackSheet from './FeedbackSheet';
import { createDmSender } from '../utils/nostrDm';
import { truncateMiddle, formatFriendlyDateTime } from '../utils/format';
import ContactProfileSheet from './ContactProfileSheet';
import type { ZapCounterpartyInfo } from '../types/wallet';
import { colors } from '../styles/theme';
import { BOLTZ_SUPPORT_NPUB, dmRecipient } from '../constants/npubs';
import { Copy } from 'lucide-react-native';

export interface TransactionDetailData {
  /** Display values the caller already has */
  type: 'incoming' | 'outgoing' | string;
  amount: number;
  description?: string;
  created_at?: number | null;
  settled_at?: number | null;
  blockHeight?: number | null;
  /** On-chain tx id (also set for Boltz claim txs) */
  txid?: string;
  /** Lightning-only detail fields */
  paymentHash?: string;
  preimage?: string;
  invoice?: string;
  feesSats?: number;
  /** Optional — if set, we can surface Boltz swap state */
  swapId?: string;
  /** Resolved Nostr counterparty info for zaps (incoming sender or outgoing recipient). */
  zapCounterparty?: ZapCounterpartyInfo | null;
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
}

type BoltzSwapView = {
  status: string;
  lockupTxId?: string;
  claimable: boolean;
  terminalSuccess: boolean;
  terminalFailure: boolean;
};

const BOLTZ_API = 'https://api.boltz.exchange/v2';

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

/**
 * Bottom sheet showing the detail for a single transaction. For rows that
 * are part of a Boltz swap we detect the paired swapId via persisted
 * state and expose a "Retry claim" button when the swap has locked funds
 * on-chain but the claim hasn't landed yet.
 */
const TransactionDetailSheet: React.FC<Props> = ({ visible, tx, onClose }) => {
  const { btcPrice, currency, activeWallet } = useWallet();
  const { isLoggedIn, signerType, sendDirectMessage } = useNostr();
  const sheetRef = useRef<BottomSheetModal>(null);
  const [swap, setSwap] = useState<BoltzSwapView | null>(null);
  const [resolvedSwapId, setResolvedSwapId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [supportSheetOpen, setSupportSheetOpen] = useState(false);
  const [senderProfileOpen, setSenderProfileOpen] = useState(false);
  // Filled in on open when the cached tx lacks preimage/invoice — some NWC
  // backends (notably LNbits) omit those fields from list_transactions.
  const [enrichment, setEnrichment] = useState<{ preimage?: string; invoice?: string }>({});

  useEffect(() => {
    if (visible) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [visible]);

  // On open, if this is a Lightning tx with a payment hash but we don't have
  // the preimage/invoice cached, look them up via NWC.
  useEffect(() => {
    setEnrichment({});
    if (!visible || !tx || !tx.paymentHash) return;
    if (tx.preimage && tx.invoice) return;
    if (!activeWallet || activeWallet.walletType === 'onchain') return;
    let cancelled = false;
    (async () => {
      const result = await nwcService.lookupInvoice(activeWallet.id, tx.paymentHash!);
      if (!cancelled && result) setEnrichment(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, tx, activeWallet]);

  // If the transaction's description hints at a Boltz swap (pending swap
  // rows are annotated with "Boltz swap in progress" by TransferSheet), or
  // the caller passed an explicit swapId, try to resolve the paired swap
  // from SecureStore + Boltz status.
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      setSwap(null);
      setResolvedSwapId(null);
      if (!tx) return;
      const looksLikeSwap =
        !!tx.swapId ||
        (tx.description && /boltz swap/i.test(tx.description)) ||
        (!tx.settled_at && !tx.blockHeight); // any pending could be a swap
      if (!looksLikeSwap) return;

      // Find a persisted swap we can pair with. Prefer explicit swapId;
      // otherwise walk the persisted index and pick the most recent.
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
  }, [tx]);

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

  if (!tx) return null;

  const isIncoming = tx.type === 'incoming';
  const amount = Math.abs(tx.amount);
  const fiat = satsToFiatString(amount, btcPrice, currency);
  const dateTs = tx.settled_at || tx.created_at;
  const dateStr = dateTs ? formatFriendlyDateTime(dateTs) : null;
  const preimage = tx.preimage || enrichment.preimage;
  const invoice = tx.invoice || enrichment.invoice;

  const effectiveSwapId = tx.swapId || resolvedSwapId || null;

  const boltzInitialMessage = (() => {
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
  })();

  const zapCounterparty = tx.zapCounterparty ?? null;
  const counterpartyNpubDisplay = zapCounterparty?.profile?.npub
    ? `${zapCounterparty.profile.npub.slice(0, 14)}…${zapCounterparty.profile.npub.slice(-6)}`
    : null;
  const counterpartyContact =
    zapCounterparty && !zapCounterparty.anonymous && zapCounterparty.pubkey
      ? {
          pubkey: zapCounterparty.pubkey,
          name: zapCounterpartyName(zapCounterparty),
          picture: zapCounterparty.profile?.picture ?? null,
          nip05: zapCounterparty.profile?.nip05 ?? null,
          lightningAddress: null,
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
            {effectiveSwapId ? (
              <Image
                source={require('../../assets/images/boltz-logo.png')}
                style={styles.boltzLogo}
                contentFit="contain"
              />
            ) : null}
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
                onPress={() => counterpartyContact && setSenderProfileOpen(true)}
                disabled={!counterpartyContact}
                accessibilityLabel={`${isIncoming ? 'Sender' : 'Recipient'} ${zapCounterpartyName(zapCounterparty)}`}
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
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Fee</Text>
              <Text style={styles.rowValue}>{tx.feesSats.toLocaleString()} sats</Text>
            </View>
          ) : null}

          {tx.txid ? (
            <CopyRow label="On-chain tx" value={tx.txid} onCopy={copyValue} />
          ) : null}

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
            {effectiveSwapId ? (
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
      {counterpartyContact ? (
        <ContactProfileSheet
          visible={senderProfileOpen}
          onClose={() => setSenderProfileOpen(false)}
          contact={counterpartyContact}
        />
      ) : null}
      <FeedbackSheet
        visible={supportSheetOpen}
        onClose={() => setSupportSheetOpen(false)}
        onSend={createDmSender(dmRecipient(BOLTZ_SUPPORT_NPUB), sendDirectMessage)}
        isLoggedIn={isLoggedIn}
        signerType={signerType}
        onLoginPress={() => {
          /* parent-screen login flow not wired here; user can log in from Account */
        }}
        title="Contact Boltz support"
        subtitle="Your message will be sent as an encrypted Nostr DM to the Boltz team."
        initialMessage={boltzInitialMessage}
        messagePrefix="[Boltz Support]"
        successTitle="Message sent"
        successMessage="Boltz support will reply via Nostr DM. Check your usual Nostr client for the response."
      />
    </>
  );
};

export default TransactionDetailSheet;
