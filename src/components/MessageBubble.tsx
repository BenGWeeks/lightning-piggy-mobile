import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Pressable, Image, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Zap, MapPin, UserRound } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import type { NostrProfile } from '../types/nostr';
import {
  buildStaticMapUrl,
  formatCoordsForDisplay,
  USER_AGENT,
  type SharedLocation,
} from '../services/locationService';
import {
  type BubbleContent,
  extractImageUrl,
  extractInvoice,
  extractLightningAddress,
  extractSharedContact,
  formatTime,
  formatRelativeFuture,
} from '../utils/messageContent';
import type { MessageReactionState } from '../utils/reactions';

interface Props {
  // Identifying fields used for testID stability and parent diffing.
  id: string;
  fromMe: boolean;
  createdAt: number;
  // Pre-classified content. The parent classifies once (gif vs location vs
  // text) so we don't re-parse `geo:` / GIF URLs on every render frame. The
  // remaining variants (image / invoice / lnaddr / contact) ride on the
  // `text` kind and are detected here on render — those parsers are cheap
  // (regex + one bolt11Decode), so the savings of pre-binding them aren't
  // worth the extra parent-side state.
  content: BubbleContent;
  // Group chats want a "From: Sender" line above non-self bubbles. 1:1 chats
  // pass `null` (the conversation is implicitly with one peer).
  senderName?: string | null;
  // Shared-contact card needs the resolved kind-0 profile to render an
  // avatar + display name. Parent owns the fetch (so it can batch and
  // cache); the bubble looks up by pubkey.
  sharedProfiles?: Record<string, NostrProfile | null>;
  // Optional invoice paid-status predicate. 1:1 polls NWC to flip "Paid";
  // groups currently can't (no per-message wallet binding), so they pass
  // `undefined` and the bubble renders as Unpaid until expiry.
  isInvoicePaid?: (paymentHash: string, fromMe: boolean) => boolean;
  // Pay-button taps. Parent opens its SendSheet pre-filled with the
  // bolt11 raw / lightning address.
  onPayInvoice: (rawInvoice: string) => void;
  onPayLightningAddress: (address: string) => void;
  // Tap a shared-contact card → parent opens its ContactProfileSheet.
  onOpenContact: (pubkey: string, profile: NostrProfile | null) => void;
  // Tap a location card → parent opens OSM in the system browser.
  onOpenLocation: (location: SharedLocation) => void;
  // Tap a GIF or image bubble → parent shows fullscreen modal. Optional —
  // when omitted the cards still render but tap is a no-op.
  onOpenGifFullscreen?: (url: string) => void;
  onOpenImageFullscreen?: (url: string) => void;
  // Long-press handler — opens the parent's MessageActionsSheet for
  // per-message reactions + zap. Optional so group bubbles (where the
  // action sheet is out of scope per #205) can omit it. When omitted the
  // long-press is a no-op rather than fall back to system text-select.
  onLongPress?: () => void;
  // NIP-25 reaction state for THIS message id, or undefined if the
  // parent hasn't fetched any reactions yet. Renders a compact pill row
  // beneath the bubble: e.g. "❤️ 2  🔥 1". Tapping a pill toggles the
  // viewer's own reaction (publish or NIP-09 delete depending on
  // whether the emoji is in `myReactions`). Pulled from the parent's
  // `reactionsByMessageId` map.
  reactions?: MessageReactionState;
  // Tap handler for a reaction pill. Receives the emoji and (when the
  // viewer has already reacted) the existing reaction event id so the
  // parent can NIP-09 delete. Optional — when omitted the pills are
  // display-only.
  onToggleReaction?: (emoji: string, existingReactionId: string | null) => void;
  // Test-id prefix lets 1:1 and group bubbles coexist in the same Maestro
  // run with stable selectors. e.g. `conversation` → `conversation-pay-…`.
  testIdPrefix: string;
}

const MessageBubble: React.FC<Props> = ({
  id,
  fromMe,
  createdAt,
  content,
  senderName,
  sharedProfiles,
  isInvoicePaid,
  onPayInvoice,
  onPayLightningAddress,
  onOpenContact,
  onOpenLocation,
  onOpenGifFullscreen,
  onOpenImageFullscreen,
  onLongPress,
  reactions,
  onToggleReaction,
  testIdPrefix,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Sender label only renders on group bubbles for incoming messages —
  // identical to existing GroupConversationScreen behaviour. Pulled into
  // a single render slot so every variant gets it for free.
  const SenderLabel = senderName ? <Text style={styles.senderLabel}>{senderName}</Text> : null;

  // Reaction pill row — rendered beneath every variant by wrapping the
  // existing bubble row in a `<View>` so the pills sit on the same axis
  // as the bubble (left for incoming, right for outgoing). When there
  // are no reactions OR the parent didn't pass any, this is null and
  // the bubble renders unchanged.
  const reactionEmojis = reactions ? Object.keys(reactions.byEmoji) : [];
  const ReactionRow =
    reactionEmojis.length > 0 ? (
      <View
        style={[styles.reactionRow, fromMe ? styles.reactionRowRight : styles.reactionRowLeft]}
        testID={`${testIdPrefix}-reactions-${id}`}
      >
        {reactionEmojis.map((emoji) => {
          const reactors = reactions!.byEmoji[emoji];
          const myReactionId = reactions!.myReactions[emoji] ?? null;
          const mine = myReactionId !== null;
          return (
            <TouchableOpacity
              key={emoji}
              activeOpacity={0.7}
              disabled={!onToggleReaction}
              onPress={() => onToggleReaction?.(emoji, myReactionId)}
              style={[styles.reactionPill, mine && styles.reactionPillMine]}
              accessibilityLabel={
                mine
                  ? `Remove your ${emoji} reaction (${reactors.length} total)`
                  : `Add ${emoji} reaction (${reactors.length} so far)`
              }
              testID={`${testIdPrefix}-reaction-${id}-${emoji}`}
            >
              <Text style={styles.reactionPillEmoji}>{emoji}</Text>
              {reactors.length > 1 ? (
                <Text style={[styles.reactionPillCount, mine && styles.reactionPillCountMine]}>
                  {reactors.length}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    ) : null;

  // Wrap each variant's bubble row in a small column so the reaction
  // row can sit immediately under it without breaking the row alignment
  // (which still flows left/right via the bubbleRow flex). Only used
  // when there are reactions to render OR the bubble has been long-
  // pressable — keeps the no-op render path identical to before #205.
  const wrapWithReactionRow = (bubble: React.ReactElement): React.ReactElement =>
    ReactionRow ? (
      <View>
        {bubble}
        {ReactionRow}
      </View>
    ) : (
      bubble
    );

  if (content.kind === 'gif') {
    return wrapWithReactionRow(
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onOpenGifFullscreen?.(content.url)}
          onLongPress={onLongPress}
          delayLongPress={350}
          style={[styles.gifCard, fromMe ? styles.gifCardMe : styles.gifCardThem]}
          accessibilityLabel={fromMe ? 'GIF sent, tap to expand' : 'GIF received, tap to expand'}
          accessibilityRole="imagebutton"
          testID={`${testIdPrefix}-gif-${id}`}
        >
          {SenderLabel}
          <ExpoImage
            source={{ uri: content.url }}
            style={styles.gifImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
            accessibilityIgnoresInvertColors
          />
          <Text style={[styles.gifTime, fromMe && styles.gifTimeMe]}>{formatTime(createdAt)}</Text>
        </TouchableOpacity>
      </View>,
    );
  }

  if (content.kind === 'location') {
    const { location } = content;
    const mapUrl = buildStaticMapUrl(location);
    return wrapWithReactionRow(
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onOpenLocation(location)}
          onLongPress={onLongPress}
          delayLongPress={350}
          style={[styles.locationCard, fromMe ? styles.locationCardMe : styles.locationCardThem]}
          accessibilityLabel={fromMe ? 'Location sent' : 'Location received'}
          testID={`${testIdPrefix}-location-${id}`}
        >
          {SenderLabel}
          <ExpoImage
            source={{ uri: mapUrl, headers: { 'User-Agent': USER_AGENT } }}
            style={styles.locationMap}
            contentFit="cover"
            cachePolicy="disk"
            transition={150}
            accessibilityIgnoresInvertColors
          />
          <View style={styles.locationBody}>
            <View style={styles.locationLabelRow}>
              <MapPin
                size={14}
                color={fromMe ? 'rgba(255,255,255,0.85)' : colors.textSupplementary}
              />
              <Text style={[styles.locationLabel, fromMe && styles.locationLabelMe]}>
                {fromMe ? 'Location sent' : 'Location'}
              </Text>
            </View>
            <Text style={[styles.locationCoords, fromMe && styles.locationCoordsMe]}>
              {formatCoordsForDisplay(location)}
            </Text>
            {location.accuracyMeters !== null ? (
              <Text style={[styles.locationAccuracy, fromMe && styles.locationAccuracyMe]}>
                ± {location.accuracyMeters} m · OpenStreetMap
              </Text>
            ) : (
              <Text style={[styles.locationAccuracy, fromMe && styles.locationAccuracyMe]}>
                OpenStreetMap
              </Text>
            )}
            <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
              {formatTime(createdAt)}
            </Text>
          </View>
        </TouchableOpacity>
      </View>,
    );
  }

  // content.kind === 'text' — fall through to per-text-format detection.
  const text = content.text;

  const imageUrl = extractImageUrl(text);
  if (imageUrl) {
    return wrapWithReactionRow(
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onOpenImageFullscreen?.(imageUrl)}
          onLongPress={onLongPress}
          delayLongPress={350}
          style={[styles.imageBubble, fromMe ? styles.imageBubbleMe : styles.imageBubbleThem]}
          accessibilityLabel={fromMe ? 'Image sent' : 'Image received'}
          accessibilityRole={onOpenImageFullscreen ? 'imagebutton' : 'image'}
          // Long-press should still fire even when there's no tap handler
          // (e.g. group bubble that doesn't expand fullscreen) — disabling
          // the entire pressable would block both. So only disable when
          // there's neither a tap nor a long-press handler.
          disabled={!onOpenImageFullscreen && !onLongPress}
          testID={`${testIdPrefix}-image-${id}`}
        >
          {SenderLabel}
          <Image
            source={{ uri: imageUrl }}
            style={styles.imageBubbleImage}
            resizeMode="cover"
            accessibilityLabel="Shared image"
          />
          <Text style={[styles.imageBubbleTime, fromMe && styles.imageBubbleTimeMe]}>
            {formatTime(createdAt)}
          </Text>
        </TouchableOpacity>
      </View>,
    );
  }

  const invoice = extractInvoice(text);
  if (invoice) {
    const expired = invoice.expiresAt !== null && invoice.expiresAt * 1000 < Date.now();
    const paid =
      invoice.paymentHash !== null &&
      isInvoicePaid !== undefined &&
      isInvoicePaid(invoice.paymentHash, fromMe);
    return wrapWithReactionRow(
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <Pressable
          onLongPress={onLongPress}
          delayLongPress={350}
          // No `onPress` — invoice cards aren't a tap target as a whole
          // (the Pay button is the actionable element). Pressable still
          // observes long-press without breaking the inner button hit.
          style={[styles.invoiceCard, fromMe ? styles.invoiceCardMe : styles.invoiceCardThem]}
          testID={`${testIdPrefix}-invoice-${id}`}
        >
          {SenderLabel}
          <Text style={[styles.invoiceLabel, fromMe && styles.invoiceLabelMe]}>
            {fromMe ? 'Invoice sent' : 'Invoice received'}
          </Text>
          <Text style={[styles.invoiceAmount, fromMe && styles.invoiceAmountMe]}>
            {invoice.amountSats !== null
              ? `${invoice.amountSats.toLocaleString()} sats`
              : 'Any amount'}
          </Text>
          {invoice.description ? (
            <Text style={[styles.invoiceMemo, fromMe && styles.invoiceMemoMe]} numberOfLines={2}>
              {invoice.description}
            </Text>
          ) : null}
          <View style={styles.invoiceTagRow}>
            {paid ? (
              <View style={[styles.invoiceTag, styles.invoiceTagPaid]}>
                <Text style={styles.invoiceTagPaidText}>Paid</Text>
              </View>
            ) : expired ? (
              <View style={[styles.invoiceTag, styles.invoiceTagExpired]}>
                <Text style={styles.invoiceTagExpiredText}>Expired</Text>
              </View>
            ) : fromMe ? (
              <View style={[styles.invoiceTag, styles.invoiceTagUnpaid]}>
                <Text style={styles.invoiceTagUnpaidText}>Unpaid</Text>
              </View>
            ) : null}
            {!paid && !expired && invoice.expiresAt !== null ? (
              <Text style={[styles.invoiceExpiry, fromMe && styles.invoiceExpiryMe]}>
                expires {formatRelativeFuture(invoice.expiresAt * 1000)}
              </Text>
            ) : null}
          </View>
          {fromMe || paid || expired ? null : (
            <TouchableOpacity
              style={styles.invoicePayButton}
              onPress={() => onPayInvoice(invoice.raw)}
              accessibilityLabel="Pay this invoice"
              testID={`${testIdPrefix}-pay-${id}`}
            >
              <Zap size={16} color={colors.white} fill={colors.white} />
              <Text style={styles.invoicePayText}>Pay</Text>
            </TouchableOpacity>
          )}
          <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
            {formatTime(createdAt)}
          </Text>
        </Pressable>
      </View>,
    );
  }

  const sharedContact = extractSharedContact(text);
  if (sharedContact) {
    const loaded = sharedProfiles ? sharedContact.pubkey in sharedProfiles : false;
    const prof = sharedProfiles?.[sharedContact.pubkey] ?? null;
    const displayName = prof?.displayName || prof?.name || `${sharedContact.pubkey.slice(0, 8)}…`;
    return wrapWithReactionRow(
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => onOpenContact(sharedContact.pubkey, prof)}
          onLongPress={onLongPress}
          delayLongPress={350}
          style={[styles.contactCard, fromMe ? styles.contactCardMe : styles.contactCardThem]}
          accessibilityLabel={`Shared contact ${displayName}`}
          testID={`${testIdPrefix}-contact-${id}`}
        >
          {SenderLabel}
          <Text style={[styles.contactLabel, fromMe && styles.contactLabelMe]}>
            {fromMe ? 'Contact shared' : 'Contact'}
          </Text>
          <View style={styles.contactBodyRow}>
            {/* Always render the silhouette as the base layer so it shows
                whether prof.picture is missing OR the Image fails to load
                (broken URL, offline, etc). When prof.picture is set, the
                Image is z-stacked on top via absoluteFillObject and covers
                the silhouette once it loads. textBody (dark) is used for
                the icon to guarantee contrast against the light avatar BG. */}
            <View style={[styles.contactAvatar, styles.contactAvatarFallback]}>
              <UserRound size={26} color={colors.textBody} strokeWidth={1.75} />
              {prof?.picture ? (
                <Image
                  source={{ uri: prof.picture }}
                  style={[StyleSheet.absoluteFillObject, { borderRadius: 22 }]}
                />
              ) : null}
            </View>
            <View style={styles.contactInfo}>
              <Text style={[styles.contactName, fromMe && styles.contactNameMe]} numberOfLines={1}>
                {loaded ? displayName : 'Loading…'}
              </Text>
              {prof?.lud16 ? (
                <Text style={[styles.contactLn, fromMe && styles.contactLnMe]} numberOfLines={1}>
                  {prof.lud16}
                </Text>
              ) : prof?.nip05 ? (
                <Text style={[styles.contactLn, fromMe && styles.contactLnMe]} numberOfLines={1}>
                  {prof.nip05}
                </Text>
              ) : null}
            </View>
          </View>
          <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
            {formatTime(createdAt)}
          </Text>
        </TouchableOpacity>
      </View>,
    );
  }

  const lnAddress = extractLightningAddress(text);
  if (lnAddress) {
    return wrapWithReactionRow(
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <Pressable
          onLongPress={onLongPress}
          delayLongPress={350}
          style={[styles.invoiceCard, fromMe ? styles.invoiceCardMe : styles.invoiceCardThem]}
          testID={`${testIdPrefix}-lnaddr-${id}`}
        >
          {SenderLabel}
          <Text style={[styles.invoiceLabel, fromMe && styles.invoiceLabelMe]}>
            {fromMe ? 'Address sent' : 'Lightning address'}
          </Text>
          <Text style={[styles.invoiceMemo, fromMe && styles.invoiceMemoMe]} numberOfLines={1}>
            {lnAddress}
          </Text>
          {fromMe ? null : (
            <TouchableOpacity
              style={styles.invoicePayButton}
              onPress={() => onPayLightningAddress(lnAddress)}
              accessibilityLabel="Pay this lightning address"
              testID={`${testIdPrefix}-pay-${id}`}
            >
              <Zap size={16} color={colors.white} fill={colors.white} />
              <Text style={styles.invoicePayText}>Pay</Text>
            </TouchableOpacity>
          )}
          <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
            {formatTime(createdAt)}
          </Text>
        </Pressable>
      </View>,
    );
  }

  // Plain text fallback — no rich content detected.
  return wrapWithReactionRow(
    <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={350}
        style={[styles.bubble, fromMe ? styles.bubbleMe : styles.bubbleThem]}
        testID={`${testIdPrefix}-text-${id}`}
      >
        {SenderLabel}
        <Text style={[styles.bubbleText, fromMe && styles.bubbleTextMe]}>{text}</Text>
        <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
          {formatTime(createdAt)}
        </Text>
      </Pressable>
    </View>,
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    bubbleRow: {
      flexDirection: 'row',
      marginVertical: 2,
    },
    bubbleRowLeft: { justifyContent: 'flex-start' },
    bubbleRowRight: { justifyContent: 'flex-end' },
    // Reaction pills sit just under the bubble on the same axis
    // (incoming → left, outgoing → right). Slight negative top margin
    // pulls them visually closer to the bubble's bottom edge so the
    // pill reads as attached to the bubble, not a separate row.
    reactionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
      marginTop: -4,
      marginBottom: 4,
      paddingHorizontal: 4,
    },
    reactionRowLeft: { justifyContent: 'flex-start' },
    reactionRowRight: { justifyContent: 'flex-end' },
    reactionPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    reactionPillMine: {
      borderColor: colors.brandPink,
      backgroundColor: colors.brandPink + '22',
    },
    reactionPillEmoji: {
      fontSize: 13,
    },
    reactionPillCount: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    reactionPillCountMine: {
      color: colors.brandPink,
    },
    senderLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSupplementary,
      marginBottom: 2,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    bubble: {
      maxWidth: '80%',
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 4,
      borderRadius: 16,
    },
    bubbleThem: {
      backgroundColor: colors.surface,
      borderBottomLeftRadius: 4,
    },
    bubbleMe: {
      backgroundColor: colors.brandPink,
      borderBottomRightRadius: 4,
    },
    bubbleText: {
      fontSize: 15,
      color: colors.textBody,
      lineHeight: 20,
    },
    bubbleTextMe: {
      color: colors.white,
    },
    bubbleTime: {
      fontSize: 10,
      color: colors.textSupplementary,
      marginTop: 4,
      alignSelf: 'flex-end',
    },
    bubbleTimeMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    invoiceCard: {
      maxWidth: '85%',
      minWidth: 240,
      paddingTop: 12,
      paddingBottom: 4,
      paddingHorizontal: 14,
      borderRadius: 14,
      borderWidth: 1,
      gap: 6,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    invoiceCardMe: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    invoiceCardThem: {
      backgroundColor: colors.surface,
      borderColor: colors.zapYellow,
    },
    invoiceLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    invoiceLabelMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    invoiceAmount: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.textHeader,
      marginTop: 2,
    },
    invoiceAmountMe: {
      color: colors.white,
    },
    invoiceMemo: {
      fontSize: 14,
      color: colors.textBody,
      marginTop: 2,
    },
    invoiceMemoMe: {
      color: 'rgba(255,255,255,0.9)',
    },
    invoiceExpiry: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 4,
    },
    invoiceExpiryMe: {
      color: 'rgba(255,255,255,0.75)',
    },
    invoiceTagRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 6,
    },
    invoiceTag: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
      alignSelf: 'flex-start',
    },
    invoiceTagPaid: {
      backgroundColor: '#2e7d32',
    },
    invoiceTagPaidText: {
      fontSize: 11,
      fontWeight: '700',
      color: '#ffffff',
      letterSpacing: 0.3,
    },
    invoiceTagUnpaid: {
      backgroundColor: 'rgba(255,255,255,0.22)',
    },
    invoiceTagUnpaidText: {
      fontSize: 11,
      fontWeight: '700',
      color: '#ffffff',
      letterSpacing: 0.3,
    },
    invoiceTagExpired: {
      backgroundColor: 'rgba(0,0,0,0.32)',
    },
    invoiceTagExpiredText: {
      fontSize: 11,
      fontWeight: '700',
      color: '#ffffff',
      letterSpacing: 0.3,
    },
    invoicePayButton: {
      marginTop: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    invoicePayText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.white,
    },
    contactCard: {
      maxWidth: '85%',
      minWidth: 240,
      paddingTop: 12,
      paddingBottom: 4,
      paddingHorizontal: 14,
      borderRadius: 14,
      borderWidth: 1,
      gap: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    contactCardMe: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    contactCardThem: {
      backgroundColor: colors.surface,
      borderColor: colors.divider,
    },
    contactLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    contactLabelMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    contactBodyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    contactAvatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.background,
    },
    contactAvatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    contactInfo: {
      flex: 1,
      minWidth: 0,
    },
    contactName: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
    },
    contactNameMe: {
      color: colors.white,
    },
    contactLn: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    contactLnMe: {
      color: 'rgba(255,255,255,0.9)',
    },
    gifCard: {
      maxWidth: '85%',
      minWidth: 240,
      borderRadius: 14,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    gifCardMe: {
      backgroundColor: colors.brandPink,
    },
    gifCardThem: {
      backgroundColor: colors.surface,
    },
    gifImage: {
      width: 240,
      height: 240,
      backgroundColor: colors.background,
    },
    gifTime: {
      fontSize: 10,
      color: colors.textSupplementary,
      alignSelf: 'flex-end',
      paddingHorizontal: 14,
      paddingVertical: 4,
    },
    gifTimeMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    locationCard: {
      maxWidth: '85%',
      minWidth: 240,
      borderRadius: 14,
      borderWidth: 1,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    locationCardMe: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    locationCardThem: {
      backgroundColor: colors.surface,
      borderColor: colors.divider,
    },
    locationMap: {
      width: '100%',
      height: 140,
      backgroundColor: colors.background,
    },
    locationBody: {
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 4,
      gap: 2,
    },
    locationLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    locationLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    locationLabelMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    locationCoords: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textHeader,
      marginTop: 2,
    },
    locationCoordsMe: {
      color: colors.white,
    },
    locationAccuracy: {
      fontSize: 12,
      color: colors.textSupplementary,
    },
    locationAccuracyMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    imageBubble: {
      maxWidth: '85%',
      minWidth: 240,
      borderRadius: 14,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    imageBubbleMe: {
      backgroundColor: colors.brandPink,
    },
    imageBubbleThem: {
      backgroundColor: colors.surface,
    },
    imageBubbleImage: {
      width: 240,
      height: 240,
      backgroundColor: colors.background,
    },
    imageBubbleTime: {
      fontSize: 10,
      color: colors.textSupplementary,
      alignSelf: 'flex-end',
      paddingHorizontal: 14,
      paddingVertical: 4,
    },
    imageBubbleTimeMe: {
      color: 'rgba(255,255,255,0.85)',
    },
  });

export default MessageBubble;
