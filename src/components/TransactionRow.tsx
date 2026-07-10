import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from '../contexts/LocaleContext';
import { satsToFiatString } from '../services/fiatService';
import TransactionTypeIcon, { type TransactionIconState } from './TransactionTypeIcon';
import type { TransactionDetailData } from './TransactionDetailSheet';
import { getTxCategory } from '../utils/txCategory';
import { isSupportedImageUrl } from '../utils/imageUrl';
import type { ZapCounterpartyInfo } from '../types/wallet';
import { AVATAR_SIZE, type TransactionListStyles } from '../styles/TransactionList.styles';
import type { TxRow } from '../utils/transactionPagination';

/**
 * One transaction-list row (day header or transaction), memoised.
 *
 * Extracted from `TransactionList.renderRow` (the #703 ConversationMessageRow
 * pattern) because FlatList re-wraps `renderItem` in a fresh closure whenever
 * the list itself re-renders — which defeats `CellRenderer`'s PureComponent
 * bail-out and re-executed EVERY visible row on every Home commit, measured
 * at ~110 ms of a ~130 ms update even when nothing changed (#1014). With the
 * row content behind `React.memo`, a re-executed cell just re-creates this
 * element and the memo bails on the (stable) props, so an unchanged row costs
 * ~nothing regardless of what invalidated the list around it.
 */

type Translate = ReturnType<typeof useTranslation>;

function zapCounterpartyLabel(cp: ZapCounterpartyInfo, t: Translate): string {
  if (cp.anonymous) return t('transactionList.anonymous');
  const profile = cp.profile;
  if (profile?.displayName) return profile.displayName;
  if (profile?.name) return profile.name;
  if (profile?.npub) return `${profile.npub.slice(0, 12)}…`;
  return t('transactionList.nostrUser');
}

// Parse URL-shaped descriptions into `{ primary, subtitle }` so a row like
// a LNURL comment shows the host prominent and the full URL/memo below,
// matching Primal's treatment.
function splitDescription(desc: string): { primary: string; subtitle: string | null } {
  const trimmed = desc.trim();
  const urlMatch = trimmed.match(/^(https?:\/\/)([^\s/]+)(.*)$/i);
  if (urlMatch) {
    const [, , host, rest] = urlMatch;
    return { primary: host, subtitle: rest.replace(/^\s*-\s*/, '').trim() || null };
  }
  return { primary: trimmed, subtitle: null };
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Extract a lightning address from a tx description. NWC/LNbits ledger
// entries frequently encode the counterparty as `user@host`, either as
// the whole string or embedded in a longer memo like
// "Zap from alice@primal.net - nice work!".
function findLud16InDescription(desc: string | undefined): string | null {
  if (!desc) return null;
  const match = desc.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

/** Minimal structural view of a contact — just what the row reads. */
interface RowContact {
  profile?: {
    displayName?: string | null;
    name?: string | null;
    picture?: string | null;
  } | null;
}

export interface TransactionRowProps {
  row: TxRow;
  styles: TransactionListStyles;
  contactProfileByPubkey: ReadonlyMap<string, ZapCounterpartyInfo['profile']>;
  contactByLud16: ReadonlyMap<string, RowContact>;
  btcPrice: number | null;
  currency: string;
  /** Live swap badge state, computed by the parent per render — a primitive,
   *  so the memo picks up badge changes by value. */
  iconState: TransactionIconState | undefined;
  onPressTx: (tx: TransactionDetailData, iconState: TransactionIconState | undefined) => void;
}

const TransactionRow: React.FC<TransactionRowProps> = ({
  row,
  styles,
  contactProfileByPubkey,
  contactByLud16,
  btcPrice,
  currency,
  iconState,
  onPressTx,
}) => {
  const t = useTranslation();
  if (row.kind === 'header') {
    return <Text style={styles.dayHeader}>{row.label}</Text>;
  }
  const item = row.tx;
  const isIncoming = item.type === 'incoming';
  const amountSats = Math.abs(item.amount);
  // `??` (not `||`) so a `0` (epoch) timestamp counts as present; only
  // null/undefined means the tx has no settle/create time yet (pending).
  const ts = item.settled_at ?? item.created_at;
  const isPending = ts == null && !item.blockHeight;
  const zapCpRaw = item.zapCounterparty ?? undefined;
  // Prefer the live profile from contacts (which refreshes when the
  // profile cache updates) over the snapshot embedded in the tx.
  const liveProfile = zapCpRaw?.pubkey ? contactProfileByPubkey.get(zapCpRaw.pubkey) : undefined;
  const zapCp = zapCpRaw ? { ...zapCpRaw, profile: liveProfile ?? zapCpRaw.profile } : undefined;

  // For non-zap transactions, attempt to resolve the counterparty
  // via a lightning-address in the description. Keyed in
  // `contactByLud16` off the user's contacts, so it only promotes
  // people they follow (same source Friends tab reads from).
  const lud16FromDescription = !zapCp ? findLud16InDescription(item.description) : null;
  const descriptionContact = lud16FromDescription
    ? contactByLud16.get(lud16FromDescription)
    : undefined;

  // Primary label: counterparty name if attributed; else contact-by-
  // lud16 name; else URL host or raw description; else
  // "Received" / "Sent".
  let primary: string;
  let subtitle: string | null = null;
  if (isPending) {
    primary = t('transactionList.pending');
  } else if (zapCp) {
    primary = zapCounterpartyLabel(zapCp, t);
    subtitle = zapCp.comment?.trim() || null;
  } else if (descriptionContact) {
    primary =
      descriptionContact.profile?.displayName ??
      descriptionContact.profile?.name ??
      lud16FromDescription ??
      (isIncoming ? t('transactionList.received') : t('transactionList.sent'));
  } else if (item.description) {
    const split = splitDescription(item.description);
    primary = split.primary;
    subtitle = split.subtitle;
  } else {
    primary = isIncoming ? t('transactionList.received') : t('transactionList.sent');
  }

  // Explicit null check so a `0` (epoch) timestamp still formats instead of
  // rendering an empty string.
  const timeStr = ts != null ? formatTime(ts) : '';
  const counterpartyAvatar =
    zapCp?.profile?.picture ?? descriptionContact?.profile?.picture ?? null;
  const fiatStr = satsToFiatString(amountSats, btcPrice, currency);

  return (
    <TouchableOpacity
      style={[styles.item, isPending && styles.itemPending]}
      onPress={() => onPressTx(item as TransactionDetailData, iconState)}
      accessibilityLabel={t('transactionList.openDetailsFor', { name: primary })}
    >
      <View style={styles.avatarWrap}>
        {counterpartyAvatar && isSupportedImageUrl(counterpartyAvatar) ? (
          <Image
            source={{ uri: counterpartyAvatar }}
            style={styles.avatar}
            cachePolicy="memory-disk"
            recyclingKey={counterpartyAvatar}
            autoplay={false}
            contentFit="cover"
          />
        ) : (
          <TransactionTypeIcon
            category={getTxCategory(item)}
            size={AVATAR_SIZE}
            state={iconState}
          />
        )}
      </View>

      <View style={styles.centerCol}>
        <View style={styles.centerLine}>
          <Text style={[styles.primary, isPending && styles.pendingText]} numberOfLines={1}>
            {primary}
          </Text>
          {timeStr ? <Text style={styles.time}> | {timeStr}</Text> : null}
        </View>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={styles.rightCol}>
        <View style={styles.amountsColumn}>
          <Text
            style={[
              styles.amount,
              isPending ? styles.pendingText : isIncoming ? styles.incoming : styles.outgoing,
            ]}
          >
            {amountSats.toLocaleString()} sats
          </Text>
          {fiatStr ? (
            <Text style={[styles.fiat, isPending && styles.pendingText]}>{fiatStr}</Text>
          ) : null}
        </View>
        <Text
          style={[
            styles.arrow,
            isPending ? styles.pendingText : isIncoming ? styles.incoming : styles.outgoing,
          ]}
        >
          {isIncoming ? '↓' : '↑'}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

export default React.memo(TransactionRow);
