import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
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
import * as boltzService from '../services/boltzService';
import * as swapRecoveryService from '../services/swapRecoveryService';
import { transactionDetailSheetStyles as styles } from '../styles/TransactionDetailSheet.styles';
import FeedbackSheet from './FeedbackSheet';
import { createDmSender } from '../utils/nostrDm';

/** Boltz support npub — DMs sent here reach the Boltz team. */
const BOLTZ_SUPPORT_NPUB = 'npub1psm37hke2pmxzdzraqe3cjmqs28dv77da74pdx8mtn5a0vegtlas9q8970';

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

/**
 * Bottom sheet showing the detail for a single transaction. For rows that
 * are part of a Boltz swap we detect the paired swapId via persisted
 * state and expose a "Retry claim" button when the swap has locked funds
 * on-chain but the claim hasn't landed yet.
 */
const TransactionDetailSheet: React.FC<Props> = ({ visible, tx, onClose }) => {
  const { btcPrice, currency } = useWallet();
  const { isLoggedIn, signerType, sendDirectMessage } = useNostr();
  const sheetRef = useRef<BottomSheetModal>(null);
  const [swap, setSwap] = useState<BoltzSwapView | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [supportSheetOpen, setSupportSheetOpen] = useState(false);

  useEffect(() => {
    if (visible) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [visible]);

  // If the transaction's description hints at a Boltz swap (pending swap
  // rows are annotated with "Boltz swap in progress" by TransferSheet), or
  // the caller passed an explicit swapId, try to resolve the paired swap
  // from SecureStore + Boltz status.
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      setSwap(null);
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
  const dateStr = dateTs ? new Date(dateTs * 1000).toLocaleString() : null;

  const hasSwapContext = !!(swap || tx.swapId);
  const boltzInitialMessage = (() => {
    const lines: string[] = ['Hi Boltz support,', ''];
    lines.push('I need help with a swap:');
    if (tx.swapId) lines.push(`• Swap ID: ${tx.swapId}`);
    if (swap?.status) lines.push(`• Status: ${swap.status}`);
    if (swap?.lockupTxId) lines.push(`• Lockup tx: ${swap.lockupTxId}`);
    if (tx.txid) lines.push(`• Claim / on-chain tx: ${tx.txid}`);
    if (tx.paymentHash) lines.push(`• Payment hash: ${tx.paymentHash}`);
    lines.push(`• Direction: ${isIncoming ? 'received' : 'sent'}`);
    lines.push(`• Amount: ${amount.toLocaleString()} sats`);
    if (dateStr) lines.push(`• Time: ${dateStr}`);
    lines.push('', 'Details:');
    lines.push('(describe the issue)');
    return lines.join('\n');
  })();

  return (
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
          <TouchableOpacity
            style={styles.row}
            onPress={() => copyValue('On-chain tx', tx.txid!)}
            accessibilityLabel="Copy on-chain tx id"
          >
            <Text style={styles.rowLabel}>On-chain tx</Text>
            <Text style={[styles.rowValue, styles.rowValueMono]} numberOfLines={1}>
              {tx.txid}
            </Text>
          </TouchableOpacity>
        ) : null}

        {swap?.lockupTxId ? (
          <TouchableOpacity
            style={styles.row}
            onPress={() => copyValue('Lockup tx', swap.lockupTxId!)}
            accessibilityLabel="Copy lockup tx id"
          >
            <Text style={styles.rowLabel}>Lockup tx</Text>
            <Text style={[styles.rowValue, styles.rowValueMono]} numberOfLines={1}>
              {swap.lockupTxId}
            </Text>
          </TouchableOpacity>
        ) : null}

        {tx.paymentHash ? (
          <TouchableOpacity
            style={styles.row}
            onPress={() => copyValue('Payment hash', tx.paymentHash!)}
            accessibilityLabel="Copy payment hash"
          >
            <Text style={styles.rowLabel}>Payment hash</Text>
            <Text style={[styles.rowValue, styles.rowValueMono]} numberOfLines={1}>
              {tx.paymentHash}
            </Text>
          </TouchableOpacity>
        ) : null}

        {tx.preimage ? (
          <TouchableOpacity
            style={styles.row}
            onPress={() => copyValue('Preimage', tx.preimage!)}
            accessibilityLabel="Copy preimage"
          >
            <Text style={styles.rowLabel}>Preimage</Text>
            <Text style={[styles.rowValue, styles.rowValueMono]} numberOfLines={1}>
              {tx.preimage}
            </Text>
          </TouchableOpacity>
        ) : null}

        {tx.invoice ? (
          <TouchableOpacity
            style={styles.row}
            onPress={() => copyValue('Invoice', tx.invoice!)}
            accessibilityLabel="Copy invoice"
          >
            <Text style={styles.rowLabel}>Invoice</Text>
            <Text style={[styles.rowValue, styles.rowValueMono]} numberOfLines={1}>
              {tx.invoice}
            </Text>
          </TouchableOpacity>
        ) : null}

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
          {swap?.claimable ? (
            <Text style={styles.info}>
              Retry re-runs the swap recovery service, which will re-broadcast the claim transaction
              from persisted swap state.
            </Text>
          ) : null}
          {hasSwapContext ? (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setSupportSheetOpen(true)}
              accessibilityLabel="Contact Boltz support"
              testID="contact-boltz-support"
            >
              <Text style={styles.secondaryButtonText}>Contact Boltz support</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </BottomSheetView>
      <FeedbackSheet
        visible={supportSheetOpen}
        onClose={() => setSupportSheetOpen(false)}
        onSend={createDmSender(BOLTZ_SUPPORT_NPUB, sendDirectMessage)}
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
    </BottomSheetModal>
  );
};

export default TransactionDetailSheet;
