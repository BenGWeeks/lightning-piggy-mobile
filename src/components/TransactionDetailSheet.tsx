import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, BackHandler } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { ArrowDown, ArrowUp } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as nip19 from 'nostr-tools/nip19';
import CopyIcon from './icons/CopyIcon';
import FeedbackSheet from './FeedbackSheet';
import { colors } from '../styles/theme';
import { satsToFiatString } from '../services/fiatService';
import { useWallet } from '../contexts/WalletContext';
import { useNostr } from '../contexts/NostrContext';
import type { Nip47Transaction } from '../services/nwcService';

const BOLTZ_SUPPORT_NPUB = 'npub1psm37hke2pmxzdzraqe3cjmqs28dv77da74pdx8mtn5a0vegtlas9q8970';

function truncateHash(value: string, leading = 8, trailing = 8): string {
  if (value.length <= leading + trailing + 3) return value;
  return `${value.slice(0, leading)}...${value.slice(-trailing)}`;
}

function formatStatus(state: string): { label: string; color: string } {
  switch (state) {
    case 'settled':
      return { label: 'Confirmed', color: colors.green };
    case 'pending':
      return { label: 'Pending', color: '#FF9800' };
    case 'failed':
      return { label: 'Failed', color: colors.red };
    case 'accepted':
      return { label: 'Accepted', color: colors.courseTeal };
    default:
      return { label: state, color: colors.textSupplementary };
  }
}

interface Props {
  visible: boolean;
  onClose: () => void;
  transaction: Nip47Transaction | null;
}

const CopyableRow: React.FC<{ label: string; value: string; fullValue?: string }> = ({
  label,
  value,
  fullValue,
}) => (
  <TouchableOpacity
    style={styles.detailRow}
    onPress={() => Clipboard.setStringAsync(fullValue || value)}
    accessibilityLabel={`Copy ${label}`}
    testID={`copy-${label.toLowerCase().replace(/\s/g, '-')}`}
  >
    <Text style={styles.detailLabel}>{label}</Text>
    <View style={styles.detailValueRow}>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
      <CopyIcon size={16} color={colors.brandPink} />
    </View>
  </TouchableOpacity>
);

const TransactionDetailSheet: React.FC<Props> = ({ visible, onClose, transaction }) => {
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['75%'], []);
  const { btcPrice, currency } = useWallet();
  const { isLoggedIn, signerType, sendDirectMessage } = useNostr();
  const [boltzSupportOpen, setBoltzSupportOpen] = useState(false);

  useEffect(() => {
    if (visible) {
      setBoltzSupportOpen(false);
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [visible, onClose]);

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

  const buildSupportMessage = useCallback(() => {
    if (!transaction) return '';
    const isIncoming = transaction.type === 'incoming';
    const amountSats = Math.abs(transaction.amount);
    const lines = [
      `[Boltz Support Request]`,
      `Type: ${isIncoming ? 'Received' : 'Sent'}`,
      `Amount: ${amountSats.toLocaleString()} sats`,
      `Status: ${transaction.state}`,
    ];
    if (transaction.payment_hash) {
      lines.push(`Payment Hash: ${transaction.payment_hash}`);
    }
    if (transaction.preimage) {
      lines.push(`Preimage: ${transaction.preimage}`);
    }
    if (transaction.description) {
      lines.push(`Description: ${transaction.description}`);
    }
    const date = transaction.settled_at || transaction.created_at;
    if (date) {
      lines.push(`Date: ${new Date(date * 1000).toLocaleString()}`);
    }
    lines.push('', '---', 'Additional details:');
    return lines.join('\n');
  }, [transaction]);

  const handleBoltzSend = useCallback(
    async (message: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const decoded = nip19.decode(BOLTZ_SUPPORT_NPUB);
        if (decoded.type !== 'npub') {
          return { success: false, error: 'Invalid Boltz support npub' };
        }
        return sendDirectMessage(decoded.data, message);
      } catch {
        return { success: false, error: 'Failed to decode Boltz support npub' };
      }
    },
    [sendDirectMessage],
  );

  if (!transaction) return null;

  const isIncoming = transaction.type === 'incoming';
  const amountSats = Math.abs(transaction.amount);
  const fiatStr = satsToFiatString(amountSats, btcPrice, currency);
  const date = transaction.settled_at || transaction.created_at;
  const dateStr = date ? new Date(date * 1000).toLocaleString() : '';
  const status = formatStatus(transaction.state);

  return (
    <>
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        onChange={handleSheetChange}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
      >
        <BottomSheetScrollView style={styles.scrollContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.typeRow}>
              {isIncoming ? (
                <ArrowDown size={24} color={colors.green} />
              ) : (
                <ArrowUp size={24} color={colors.red} />
              )}
              <Text style={styles.typeLabel}>{isIncoming ? 'Received' : 'Sent'}</Text>
              <View style={[styles.statusBadge, { backgroundColor: status.color + '20' }]}>
                <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
              </View>
            </View>
          </View>

          {/* Amount */}
          <View style={styles.amountSection}>
            <Text style={[styles.amountSats, isIncoming ? styles.incoming : styles.outgoing]}>
              {isIncoming ? '+' : '-'}
              {amountSats.toLocaleString()} sats
            </Text>
            {fiatStr ? <Text style={styles.amountFiat}>{fiatStr}</Text> : null}
          </View>

          {/* Date */}
          {dateStr ? (
            <View style={styles.dateRow}>
              <Text style={styles.detailLabel}>Date</Text>
              <Text style={styles.dateValue}>{dateStr}</Text>
            </View>
          ) : null}

          {/* Divider */}
          <View style={styles.divider} />

          {/* Details */}
          <View style={styles.detailsSection}>
            {transaction.description ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Description</Text>
                <Text style={styles.detailValueText}>{transaction.description}</Text>
              </View>
            ) : null}

            {transaction.payment_hash ? (
              <CopyableRow
                label="Payment Hash"
                value={truncateHash(transaction.payment_hash)}
                fullValue={transaction.payment_hash}
              />
            ) : null}

            {transaction.preimage ? (
              <CopyableRow
                label="Preimage"
                value={truncateHash(transaction.preimage)}
                fullValue={transaction.preimage}
              />
            ) : null}

            {transaction.fees_paid > 0 ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Fee Paid</Text>
                <Text style={styles.detailValueText}>
                  {transaction.fees_paid.toLocaleString()} sats
                </Text>
              </View>
            ) : null}

            {transaction.invoice ? (
              <CopyableRow
                label="Invoice"
                value={truncateHash(transaction.invoice, 12, 8)}
                fullValue={transaction.invoice}
              />
            ) : null}
          </View>

          {/* Boltz Support */}
          <View style={styles.supportSection}>
            <TouchableOpacity
              style={styles.supportButton}
              onPress={() => setBoltzSupportOpen(true)}
              accessibilityLabel="Contact Boltz Support"
              testID="contact-boltz-support"
            >
              <Text style={styles.supportButtonText}>Contact Boltz Support</Text>
            </TouchableOpacity>
          </View>
        </BottomSheetScrollView>
      </BottomSheetModal>

      <FeedbackSheet
        visible={boltzSupportOpen}
        onClose={() => setBoltzSupportOpen(false)}
        onSend={handleBoltzSend}
        isLoggedIn={isLoggedIn}
        signerType={signerType}
        onLoginPress={() => {
          setBoltzSupportOpen(false);
        }}
        title="Contact Boltz Support"
        subtitle="Send an encrypted Nostr DM to Boltz with your transaction details."
        initialMessage={buildSupportMessage()}
        successTitle="Message Sent"
        successMessage="Your support request has been sent to Boltz."
      />
    </>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handleIndicator: {
    backgroundColor: colors.divider,
    width: 40,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textHeader,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  amountSection: {
    alignItems: 'center',
    marginBottom: 16,
  },
  amountSats: {
    fontSize: 28,
    fontWeight: '700',
  },
  amountFiat: {
    fontSize: 16,
    color: colors.textSupplementary,
    marginTop: 4,
  },
  incoming: {
    color: colors.green,
  },
  outgoing: {
    color: colors.red,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  dateValue: {
    fontSize: 14,
    color: colors.textBody,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: 12,
  },
  detailsSection: {
    gap: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  detailLabel: {
    fontSize: 14,
    color: colors.textSupplementary,
    fontWeight: '500',
  },
  detailValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    justifyContent: 'flex-end',
  },
  detailValue: {
    fontSize: 13,
    color: colors.textBody,
    fontWeight: '500',
    maxWidth: '70%',
  },
  detailValueText: {
    fontSize: 14,
    color: colors.textBody,
    flex: 1,
    textAlign: 'right',
  },
  supportSection: {
    marginTop: 20,
    paddingBottom: 20,
  },
  supportButton: {
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.brandPink,
  },
  supportButtonText: {
    color: colors.brandPink,
    fontSize: 14,
    fontWeight: '700',
  },
});

export default TransactionDetailSheet;
