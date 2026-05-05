import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Zap, MapPin, UserRound, Check, CheckCheck, AlertCircle } from 'lucide-react-native';
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
import type { MessageDeliveryStatus } from '../utils/messageDeliveryStatus';

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
  // Test-id prefix lets 1:1 and group bubbles coexist in the same Maestro
  // run with stable selectors. e.g. `conversation` → `conversation-pay-…`.
  testIdPrefix: string;
  // WhatsApp-style delivery indicator for `fromMe` bubbles only — see
  // `MessageDeliveryStatus`. `undefined` (the default for incoming bubbles
  // and for historical messages loaded from the relay cache without a
  // local-send record) suppresses the tick row entirely. Issue #110.
  deliveryStatus?: MessageDeliveryStatus;
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
  testIdPrefix,
  deliveryStatus,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Sender label only renders on group bubbles for incoming messages —
  // identical to existing GroupConversationScreen behaviour. Pulled into
  // a single render slot so every variant gets it for free.
  const SenderLabel = senderName ? <Text style={styles.senderLabel}>{senderName}</Text> : null;

  // WhatsApp-style tick row for outgoing bubbles. Pulled out so every
  // variant (text / image / invoice / contact / gif / location) renders
  // the same indicator without duplicating the icon-by-status switch.
  // Lucide icons aren't sized via fontSize, so we keep them inline with
  // the timestamp through a flex row in the per-variant time wrapper.
  const renderTicks = (): React.ReactNode => {
    if (!fromMe || !deliveryStatus) return null;
    return (
      <DeliveryTicks
        status={deliveryStatus}
        // Brand-pink bubbles use a translucent-white tone; the few
        // outgoing variants whose footer sits on a non-pink background
        // (gif, image, location — the time text uses textSupplementary
        // there too via gifTimeMe / imageBubbleTimeMe overrides) re-use
        // the same translucent ramp because the bubble surface beneath
        // is still brand-pink. Failed always renders red regardless of
        // surface so it can't be missed.
        colors={colors}
        testID={`${testIdPrefix}-ticks-${id}`}
      />
    );
  };

  if (content.kind === 'gif') {
    return (
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onOpenGifFullscreen?.(content.url)}
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
          <View style={[styles.gifFooter, fromMe && styles.gifFooterMe]}>
            <Text style={[styles.gifTime, fromMe && styles.gifTimeMe]}>
              {formatTime(createdAt)}
            </Text>
            {renderTicks()}
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  if (content.kind === 'location') {
    const { location } = content;
    const mapUrl = buildStaticMapUrl(location);
    return (
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onOpenLocation(location)}
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
            <View style={styles.timeRow}>
              <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
                {formatTime(createdAt)}
              </Text>
              {renderTicks()}
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  // content.kind === 'text' — fall through to per-text-format detection.
  const text = content.text;

  const imageUrl = extractImageUrl(text);
  if (imageUrl) {
    return (
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onOpenImageFullscreen?.(imageUrl)}
          style={[styles.imageBubble, fromMe ? styles.imageBubbleMe : styles.imageBubbleThem]}
          accessibilityLabel={fromMe ? 'Image sent' : 'Image received'}
          accessibilityRole={onOpenImageFullscreen ? 'imagebutton' : 'image'}
          disabled={!onOpenImageFullscreen}
          testID={`${testIdPrefix}-image-${id}`}
        >
          {SenderLabel}
          <Image
            source={{ uri: imageUrl }}
            style={styles.imageBubbleImage}
            resizeMode="cover"
            accessibilityLabel="Shared image"
          />
          <View style={[styles.imageBubbleFooter, fromMe && styles.imageBubbleFooterMe]}>
            <Text style={[styles.imageBubbleTime, fromMe && styles.imageBubbleTimeMe]}>
              {formatTime(createdAt)}
            </Text>
            {renderTicks()}
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  const invoice = extractInvoice(text);
  if (invoice) {
    const expired = invoice.expiresAt !== null && invoice.expiresAt * 1000 < Date.now();
    const paid =
      invoice.paymentHash !== null &&
      isInvoicePaid !== undefined &&
      isInvoicePaid(invoice.paymentHash, fromMe);
    return (
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <View style={[styles.invoiceCard, fromMe ? styles.invoiceCardMe : styles.invoiceCardThem]}>
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
          <View style={styles.timeRow}>
            <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
              {formatTime(createdAt)}
            </Text>
            {renderTicks()}
          </View>
        </View>
      </View>
    );
  }

  const sharedContact = extractSharedContact(text);
  if (sharedContact) {
    const loaded = sharedProfiles ? sharedContact.pubkey in sharedProfiles : false;
    const prof = sharedProfiles?.[sharedContact.pubkey] ?? null;
    const displayName = prof?.displayName || prof?.name || `${sharedContact.pubkey.slice(0, 8)}…`;
    return (
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => onOpenContact(sharedContact.pubkey, prof)}
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
          <View style={styles.timeRow}>
            <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
              {formatTime(createdAt)}
            </Text>
            {renderTicks()}
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  const lnAddress = extractLightningAddress(text);
  if (lnAddress) {
    return (
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <View style={[styles.invoiceCard, fromMe ? styles.invoiceCardMe : styles.invoiceCardThem]}>
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
          <View style={styles.timeRow}>
            <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
              {formatTime(createdAt)}
            </Text>
            {renderTicks()}
          </View>
        </View>
      </View>
    );
  }

  // Plain text fallback — no rich content detected.
  return (
    <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
      <View style={[styles.bubble, fromMe ? styles.bubbleMe : styles.bubbleThem]}>
        {SenderLabel}
        <Text style={[styles.bubbleText, fromMe && styles.bubbleTextMe]}>{text}</Text>
        <View style={styles.timeRow}>
          <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
            {formatTime(createdAt)}
          </Text>
          {renderTicks()}
        </View>
      </View>
    </View>
  );
};

/**
 * Tick row for outgoing bubbles. Renders a Lucide icon next to the
 * timestamp, coloured by status:
 *
 *  - sending  → single grey check (greyed out — not yet acknowledged)
 *  - sent     → single check, on-bubble accent
 *  - delivered → double check (CheckCheck), on-bubble accent
 *  - failed   → AlertCircle in brand red (high contrast)
 *
 * `accessibilityLabel` lets the bubble be queried by Maestro and read
 * aloud by screen readers — useful both for testing and for a11y.
 */
type DeliveryTicksProps = {
  status: MessageDeliveryStatus;
  colors: Palette;
  testID?: string;
};

const DeliveryTicks: React.FC<DeliveryTicksProps> = ({ status, colors, testID }) => {
  // 12px matches the timestamp font-size so the icon optically aligns
  // with the time text on the same line.
  const iconSize = 12;

  // Outgoing bubbles use a brand-pink surface, so default the icon tint
  // to a translucent-white that mirrors `bubbleTimeMe`. The 'failed'
  // state uses brand red regardless of surface — it's the one state we
  // want the user to spot at a glance.
  const accent = 'rgba(255,255,255,0.85)';
  const muted = 'rgba(255,255,255,0.55)';
  const failedColor = colors.red;

  const a11yLabel: Record<MessageDeliveryStatus, string> = {
    sending: 'Sending',
    sent: 'Sent',
    delivered: 'Delivered',
    failed: 'Send failed',
  };

  let icon: React.ReactNode;
  switch (status) {
    case 'sending':
      icon = <Check size={iconSize} color={muted} strokeWidth={2.5} />;
      break;
    case 'sent':
      icon = <Check size={iconSize} color={accent} strokeWidth={2.5} />;
      break;
    case 'delivered':
      icon = <CheckCheck size={iconSize} color={accent} strokeWidth={2.5} />;
      break;
    case 'failed':
      icon = <AlertCircle size={iconSize} color={failedColor} strokeWidth={2.5} />;
      break;
  }

  return (
    <View
      style={ticksStyles.row}
      accessibilityLabel={a11yLabel[status]}
      accessibilityRole="image"
      testID={testID}
    >
      {icon}
    </View>
  );
};

const ticksStyles = StyleSheet.create({
  row: {
    marginLeft: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
});

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    bubbleRow: {
      flexDirection: 'row',
      marginVertical: 2,
    },
    bubbleRowLeft: { justifyContent: 'flex-start' },
    bubbleRowRight: { justifyContent: 'flex-end' },
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
    },
    bubbleTimeMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    // Wraps the timestamp + (optional) delivery ticks in a single
    // bottom-right row. Replaces the prior `marginTop:4 / alignSelf:flex-end`
    // direct on `bubbleTime` so the icon sits inline with the time text.
    timeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-end',
      marginTop: 4,
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
    // The gif card has a full-bleed image, so the time + ticks need
    // their own padded footer to sit inside the rounded rect rather
    // than over the image. Footer padding is unconditional; the
    // `Me` variant exists only so theme overrides can hook here later.
    gifFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-end',
      paddingHorizontal: 14,
      paddingVertical: 4,
    },
    gifFooterMe: {},
    gifTime: {
      fontSize: 10,
      color: colors.textSupplementary,
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
    // Mirrors gifFooter — see the comment there. Image bubbles also
    // have a full-bleed image so the timestamp + ticks need their own
    // padded footer beneath it.
    imageBubbleFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-end',
      paddingHorizontal: 14,
      paddingVertical: 4,
    },
    imageBubbleFooterMe: {},
    imageBubbleTime: {
      fontSize: 10,
      color: colors.textSupplementary,
    },
    imageBubbleTimeMe: {
      color: 'rgba(255,255,255,0.85)',
    },
  });

export default MessageBubble;
