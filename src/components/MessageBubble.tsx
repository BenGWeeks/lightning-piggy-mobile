import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, Linking } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Zap, UserRound, Radio } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import {
  createMessageBubbleStyles,
  type MessageBubbleStyles,
} from '../styles/MessageBubble.styles';
import type { NostrProfile } from '../types/nostr';
import { formatCoordsForDisplay, type SharedLocation } from '../services/locationService';
import type { BtcMapPlace } from '../services/btcMapService';
import type { ParsedCache, ParsedEvent } from '../services/nostrPlacesService';
import {
  type BubbleContent,
  type ParsedImageMessage,
  extractBitcoinUri,
  parseImageMessage,
  parseVoiceNote,
  extractInvoice,
  extractLightningAddress,
  extractSharedContact,
  isSecretModeTrigger,
  formatTime,
  formatRelativeFuture,
} from '../utils/messageContent';
import type { PollAggregate } from '../utils/pollMessage';
import { isSupportedImageUrl } from '../utils/imageUrl';
import { type DeliveryStatus } from '../utils/dmDeliveryStatus';
import { extractUrls } from '../utils/extractUrls';
import { linkifySegments, hasLink } from '../utils/linkify';
import { isBlocklisted } from '../services/linkPreviewBlocklist';
import type { MessageReactionState } from '../utils/reactions';
import MessageLinkPreview from './MessageLinkPreview';
import VoiceNotePlayer from './VoiceNotePlayer';
import DecryptedImage from './DecryptedImage';
import LibreMiniMap from './LibreMiniMap';
import { BubbleFooter } from './MessageBubbleFooter';
import { PollBubble } from './PollBubble';
import { LocationBubble } from './LocationBubble';

// Stable empty arrays for the location-card mini-maps — LibreMiniMap
// requires merchants/caches/events, but DM cards never plot any. Module
// constants so the memoised map doesn't see a fresh [] each render.
const EMPTY_MERCHANTS: BtcMapPlace[] = [];
const EMPTY_CACHES: ParsedCache[] = [];
const EMPTY_EVENTS: ParsedEvent[] = [];

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
  // Live-location bubble extras. The parent owns the live state (most
  // recent ping, remaining time) so the bubble stays a pure renderer
  // and doesn't need its own context dependency.
  //   - `liveLocationLatest`: latest coords seen since the start marker
  //     landed, keyed by sessionId. Falls back to the marker's coords.
  //   - `liveLocationStatus`: `active` | `paused` | `ended` per session.
  //   - `liveLocationRemainingMs`: countdown for the sender's bubble.
  //   - `onStopLiveLocation`: tapped the in-bubble "Stop" button (sender
  //     side only — pass `undefined` for receiver bubbles).
  liveLocationLatest?: Record<string, { location: SharedLocation; ts: number } | undefined>;
  liveLocationStatus?: Record<string, 'active' | 'paused' | 'ended' | 'expired' | undefined>;
  liveLocationRemainingMs?: Record<string, number | undefined>;
  onStopLiveLocation?: (sessionId: string) => void;
  // Location-card mini-map plumbing (#206). All optional — group bubbles
  // pass none, so their cards just centre on the shared point with no
  // me-dot / peer marker.
  myLat?: number | null; // my live latitude (for the blue "me" dot)
  myLon?: number | null; // my live longitude
  myAccuracyMetres?: number | null; // my GPS accuracy → blue halo radius
  myAvatarUri?: string | null; // my own profile picture → "me" dot avatar
  peerAvatarUri?: string | null; // the other party's profile picture URL
  onOpenMap?: () => void; // tap the mini-map → open the full-screen Map
  // Tap a GIF or image bubble → parent shows fullscreen modal. Optional —
  // when omitted the cards still render but tap is a no-op.
  onOpenGifFullscreen?: (url: string) => void;
  onOpenImageFullscreen?: (url: string) => void;
  // Pre-aggregated poll tally keyed by poll-message id. The parent runs
  // `aggregateVotes` over the conversation history once per messages
  // update; the bubble looks up its own row by `id`. When `undefined`,
  // poll bubbles still render but with zero counts (cold start).
  pollAggregates?: Map<string, PollAggregate>;
  // Tap an option row on a poll → parent sends the vote message.
  // Optional: omit on read-only contexts (none currently).
  onVotePoll?: (pollId: string, optionId: number) => void;
  // Tapping the "Toggle Secret Mode" button on the magic-trigger card
  // (when the message body is exactly "secretthreewords"). Parent
  // owns the secretMode setter + celebration overlay so a list of
  // cells doesn't each render their own confetti instance.
  onToggleSecretMode?: () => void;
  // Test-id prefix lets 1:1 and group bubbles coexist in the same Maestro
  // run with stable selectors. e.g. `conversation` → `conversation-pay-…`.
  testIdPrefix: string;
  // Per-relay delivery breakdown for a sent (fromMe) message (#856). Drives
  // the footer tick; absent on received bubbles.
  deliveryStatus?: DeliveryStatus;
  // Wire protocol (4 = NIP-04, 14/15 = NIP-17) for the message-info sheet.
  wireKind?: number;
  // Tapping a bubble (sent OR received) opens the message-info sheet. The
  // parent builds the MessageInfo from these fields; `resendText` is the raw
  // payload for the sheet's Re-publish (sent text only). (#856)
  onShowInfo?: (args: {
    fromMe: boolean;
    eventId: string;
    wireKind?: number;
    deliveryStatus?: DeliveryStatus;
    resendText: string;
  }) => void;
  // Long-press handler (#205) — opens the parent's MessageActionsSheet for
  // per-message reactions + zap. Optional; when omitted the long-press is a
  // no-op rather than falling back to system text-select.
  onLongPress?: () => void;
  // NIP-25 reaction state for THIS message id, or undefined if the parent
  // hasn't fetched any reactions yet. Renders a compact pill row beneath the
  // bubble: e.g. "❤️ 2  🔥 1". Tapping a pill toggles the viewer's own
  // reaction. Pulled from the parent's `reactionsByTarget` map (#205).
  reactions?: MessageReactionState;
  // Tap handler for a reaction pill. Receives the emoji and (when the viewer
  // has already reacted) the existing reaction event id so the parent can
  // NIP-09 delete. Optional — when omitted the pills are display-only.
  onToggleReaction?: (emoji: string, existingReactionId: string | null) => void;
}

type Styles = MessageBubbleStyles;

/**
 * Image bubble (#688). Lives in its own component because the encrypted
 * branch needs render state (the resolved displayable URI for the fullscreen
 * tap) — a hook can't be called from inside MessageBubble's body, which has
 * earlier conditional returns. Renders DecryptedImage, which handles both the
 * plain-URL and fetch-ciphertext→decrypt paths.
 */
const ImageBubble: React.FC<{
  styles: Styles;
  image: ParsedImageMessage;
  fromMe: boolean;
  senderLabel: React.ReactNode;
  onOpenImageFullscreen?: (url: string) => void;
  // Long-press → parent's MessageActionsSheet (#205). Kept firing even when
  // there's no fullscreen tap handler, so the pressable is only disabled when
  // BOTH the tap and the long-press are absent.
  onLongPress?: () => void;
  testID: string;
  // Shared time + delivery-tick footer (#856). Passed in so a sent image shows
  // the tick like every other variant.
  footer: React.ReactNode;
}> = ({
  styles,
  image,
  fromMe,
  senderLabel,
  onOpenImageFullscreen,
  onLongPress,
  testID,
  footer,
}) => {
  const t = useTranslation();
  // For plain images the fetchable URL is the display source; for encrypted
  // ones DecryptedImage resolves a data: URI, which it reports back here so
  // the fullscreen tap shows the decrypted image, not the ciphertext blob.
  const [displayUri, setDisplayUri] = useState<string | null>(image.encrypted ? null : image.url);
  const canOpen = !!onOpenImageFullscreen && !!displayUri;
  return (
    <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => displayUri && onOpenImageFullscreen?.(displayUri)}
        onLongPress={onLongPress}
        delayLongPress={350}
        style={[styles.imageBubble, fromMe ? styles.imageBubbleMe : styles.imageBubbleThem]}
        accessibilityLabel={
          fromMe ? t('messageBubble.imageSent') : t('messageBubble.imageReceived')
        }
        // Announce as an image-button whenever it's interactive — either it can
        // open fullscreen (tap) OR it can open the actions sheet (long-press).
        // Only a purely-static image announces as a plain 'image'.
        accessibilityRole={canOpen || onLongPress ? 'imagebutton' : 'image'}
        disabled={!canOpen && !onLongPress}
        testID={testID}
      >
        {senderLabel}
        <DecryptedImage
          url={image.url}
          encrypted={image.encrypted}
          keyHex={image.keyHex}
          nonceHex={image.nonceHex}
          mime={image.mime}
          style={styles.imageBubbleImage}
          accessibilityLabel={t('messageBubble.sharedImage')}
          onResolved={image.encrypted ? setDisplayUri : undefined}
        />
        {footer}
      </TouchableOpacity>
    </View>
  );
};

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
  liveLocationLatest,
  liveLocationStatus,
  liveLocationRemainingMs,
  onStopLiveLocation,
  myLat,
  myLon,
  myAccuracyMetres,
  myAvatarUri,
  peerAvatarUri,
  onOpenMap,
  onOpenGifFullscreen,
  onOpenImageFullscreen,
  pollAggregates,
  onVotePoll,
  onToggleSecretMode,
  testIdPrefix,
  deliveryStatus,
  wireKind,
  onShowInfo,
  onLongPress,
  reactions,
  onToggleReaction,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createMessageBubbleStyles(colors), [colors]);
  const t = useTranslation();

  // Sender label only renders on group bubbles for incoming messages —
  // identical to existing GroupConversationScreen behaviour. Pulled into
  // a single render slot so every variant gets it for free.
  const SenderLabel = senderName ? <Text style={styles.senderLabel}>{senderName}</Text> : null;

  // Reaction pill row (#205) — rendered beneath every variant by wrapping the
  // bubble row in a column so the pills sit on the same axis as the bubble
  // (left for incoming, right for outgoing). Null when there are no reactions,
  // so the no-op render path stays identical to before #205.
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
              accessibilityRole="button"
              accessibilityState={{ disabled: !onToggleReaction }}
              accessibilityLabel={
                mine
                  ? t('messageBubble.reactionRemove', { emoji, count: reactors.length })
                  : t('messageBubble.reactionAdd', { emoji, count: reactors.length })
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

  // Wrap a variant's bubble row in a small column so the reaction row can sit
  // immediately under it without breaking the row's left/right alignment. Only
  // wraps when there are reactions to render — otherwise returns the bubble
  // unchanged so the render path is byte-identical to pre-#205.
  const wrapWithReactionRow = (bubble: React.ReactElement): React.ReactElement =>
    ReactionRow ? (
      <View>
        {bubble}
        {ReactionRow}
      </View>
    ) : (
      bubble
    );

  // Legacy NIP-04 (kind 4) messages are coloured purple so the user can tell
  // them apart from the encrypted NIP-17 (kind 14/15) pink ones at a glance
  // (#856 follow-up). Plain text only — NIP-04 never carries gift-wrapped media.
  const isNip04 = wireKind === 4;

  // Raw payload to hand the Re-publish action (#856). For text bubbles it's the
  // message text; for GIF it's the URL (re-sending re-publishes the same GIF).
  // Other media (image/voice) ride on the `text` kind too, so this covers them.
  const resendPayload =
    content.kind === 'text' ? content.text : content.kind === 'gif' ? content.url : '';

  // Opens the message-info sheet — for sent AND received bubbles (#856). The
  // bubble's `id` is prefixed (`dm-<eventId>`); strip it so the sheet shows the
  // bare event id. The rumor id (deliveryStatus.eventId) is preferred for sent.
  const openInfo = onShowInfo
    ? () =>
        onShowInfo({
          fromMe,
          eventId: deliveryStatus?.eventId ?? id.replace(/^dm-/, ''),
          wireKind,
          deliveryStatus,
          resendText: resendPayload,
        })
    : undefined;

  // Shield-affordance tint: white on a coloured (sent) bubble, supplementary
  // grey on a surface (received) one — readable on either background (#856).
  const infoTint = fromMe ? colors.white : colors.textSupplementary;

  // Reusable footer (time + delivery tick) shared by every bubble variant so a
  // sent GIF / image / voice note / location / invoice all show the tick, not
  // just plain text (#856). Each variant passes its own time style.
  const renderFooter = (timeStyle: object | (object | undefined)[]) => (
    <BubbleFooter
      styles={styles}
      messageId={id}
      fromMe={fromMe}
      createdAt={createdAt}
      timeStyle={timeStyle}
      deliveryStatus={deliveryStatus}
      onOpenInfo={openInfo}
      infoTint={infoTint}
    />
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
          accessibilityLabel={fromMe ? t('messageBubble.gifSent') : t('messageBubble.gifReceived')}
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
          {renderFooter([styles.gifTime, fromMe && styles.gifTimeMe])}
        </TouchableOpacity>
      </View>,
    );
  }

  if (content.kind === 'liveLocationMarker') {
    const { marker } = content;
    // No separate card for the end marker — it would duplicate the start card (which flips to "ended"); its coords are folded into liveLocationLatest so the one card shows the last known location.
    if (marker.phase === 'end') return null;
    // The receiver's running view of where the sender is right now —
    // ConversationScreen feeds this from its kind-20069 subscription.
    // Falls back to the marker's own coordinates so the bubble always
    // renders a map even before the first ping has landed.
    const latest = liveLocationLatest?.[marker.sessionId];
    // May be null on a coordless `end` marker (sender stopped with no fix).
    const displayLocation: SharedLocation | null = latest?.location ?? marker.location;
    // Map centre: my own live position on my outgoing share, the peer's
    // latest position on an incoming one. Falls back to the marker coords
    // when my live fix isn't wired / hasn't landed yet.
    const haveMine = typeof myLat === 'number' && typeof myLon === 'number';
    const centreLat = fromMe && haveMine ? myLat : (displayLocation?.lat ?? null);
    const centreLon = fromMe && haveMine ? myLon : (displayLocation?.lon ?? null);
    // My blue dot shows on incoming cards (where am I vs them) and on my
    // own live share. Suppressed when I have no fix.
    const showMyDot = haveMine;
    // Peer avatar marker only on incoming cards, at their location. The
    // `peerAvatarUri !== undefined` guard scopes this to the 1:1 path —
    // group bubbles pass no avatar plumbing, so their card just centres
    // on the point with no peer chip (#206 group follow-up).
    const peerMarker =
      !fromMe && displayLocation && peerAvatarUri !== undefined
        ? { lat: displayLocation.lat, lon: displayLocation.lon, avatarUri: peerAvatarUri ?? null }
        : null;
    // Only `start` markers reach here (end markers return null above), so the wall-clock default is 'active' unless the context says otherwise.
    const status = liveLocationStatus?.[marker.sessionId] ?? 'active';
    const remaining = liveLocationRemainingMs?.[marker.sessionId] ?? null;
    // Sender bubble while the share is still active gets a Stop button.
    // Receiver bubbles never see one (no `onStopLiveLocation` plumbed).
    const showStop = fromMe && status === 'active' && !!onStopLiveLocation;
    const titleText =
      status === 'ended' || status === 'expired'
        ? t('messageBubble.liveLocationEnded')
        : status === 'paused'
          ? fromMe
            ? t('messageBubble.liveLocationPaused')
            : t('messageBubble.liveLocationPausedThem')
          : fromMe
            ? t('messageBubble.sharingLiveLocation')
            : t('messageBubble.liveLocation');
    const subtitleText: string | null = (() => {
      if (status === 'ended' || status === 'expired') {
        return latest
          ? t('messageBubble.lastUpdate', { time: formatTime(Math.floor(latest.ts / 1000)) })
          : null;
      }
      if (latest) {
        const ageMs = Math.max(0, Date.now() - latest.ts);
        const mins = Math.floor(ageMs / 60_000);
        const secs = Math.floor((ageMs % 60_000) / 1000);
        if (mins >= 1) return t('messageBubble.updatedMinsAgo', { mins });
        return t('messageBubble.updatedSecsAgo', { secs });
      }
      return t('messageBubble.waitingForFirstUpdate');
    })();
    const remainingLabel: string | null = (() => {
      if (status === 'ended' || status === 'expired') return null;
      if (remaining === null) return null;
      if (remaining <= 0) return t('messageBubble.ending');
      const mins = Math.ceil(remaining / 60_000);
      if (mins < 60) return t('messageBubble.minsLeft', { mins });
      const hours = Math.floor(mins / 60);
      const remMin = mins % 60;
      return remMin === 0
        ? t('messageBubble.hoursLeft', { hours })
        : t('messageBubble.hoursMinsLeft', { hours, mins: remMin });
    })();
    return wrapWithReactionRow(
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => displayLocation && onOpenLocation(displayLocation)}
          onLongPress={onLongPress}
          delayLongPress={350}
          style={[styles.locationCard, fromMe ? styles.locationCardMe : styles.locationCardThem]}
          accessibilityLabel={
            fromMe
              ? t('messageBubble.sharingLiveLocationA11y', {
                  remaining: remainingLabel ?? t('messageBubble.noTimeRemaining'),
                })
              : t('messageBubble.receivingLiveLocationA11y', {
                  status: subtitleText ?? t('messageBubble.waiting'),
                })
          }
          testID={`${testIdPrefix}-live-location-${id}`}
        >
          {SenderLabel}
          {centreLat !== null && centreLon !== null ? (
            <View style={styles.locationMap}>
              <LibreMiniMap
                lat={centreLat}
                lon={centreLon}
                merchants={EMPTY_MERCHANTS}
                caches={EMPTY_CACHES}
                events={EMPTY_EVENTS}
                fill
                defaultZoom={15}
                userLat={showMyDot ? (myLat ?? null) : null}
                userLon={showMyDot ? (myLon ?? null) : null}
                userAccuracyMetres={showMyDot ? (myAccuracyMetres ?? null) : null}
                userAvatarUri={showMyDot ? (myAvatarUri ?? null) : null}
                profileMarker={peerMarker}
                onTapMap={onOpenMap}
              />
            </View>
          ) : null}
          <View style={styles.locationBody}>
            <View style={styles.locationLabelRow}>
              <Radio
                size={14}
                color={fromMe ? 'rgba(255,255,255,0.85)' : colors.textSupplementary}
              />
              <Text style={[styles.locationLabel, fromMe && styles.locationLabelMe]}>
                {titleText}
              </Text>
            </View>
            {displayLocation ? (
              <Text style={[styles.locationCoords, fromMe && styles.locationCoordsMe]}>
                {formatCoordsForDisplay(displayLocation)}
              </Text>
            ) : null}
            {subtitleText ? (
              <Text style={[styles.locationAccuracy, fromMe && styles.locationAccuracyMe]}>
                {subtitleText}
              </Text>
            ) : null}
            {remainingLabel ? (
              <Text style={[styles.locationAccuracy, fromMe && styles.locationAccuracyMe]}>
                {remainingLabel}
              </Text>
            ) : null}
            {showStop ? (
              <TouchableOpacity
                style={styles.liveStopButton}
                onPress={() => onStopLiveLocation?.(marker.sessionId)}
                accessibilityLabel={t('messageBubble.stopSharingLiveLocation')}
                testID={`${testIdPrefix}-live-location-stop-${id}`}
              >
                <Text style={styles.invoicePayText}>{t('messageBubble.stopSharing')}</Text>
              </TouchableOpacity>
            ) : null}
            {renderFooter([styles.bubbleTime, fromMe && styles.bubbleTimeMe])}
          </View>
        </TouchableOpacity>
      </View>,
    );
  }

  if (content.kind === 'location') {
    return wrapWithReactionRow(
      <LocationBubble
        location={content.location}
        fromMe={fromMe}
        id={id}
        testIdPrefix={testIdPrefix}
        styles={styles}
        senderLabel={SenderLabel}
        footer={renderFooter([styles.bubbleTime, fromMe && styles.bubbleTimeMe])}
        myLat={myLat}
        myLon={myLon}
        myAccuracyMetres={myAccuracyMetres}
        myAvatarUri={myAvatarUri}
        peerAvatarUri={peerAvatarUri}
        onOpenLocation={onOpenLocation}
        onOpenMap={onOpenMap}
        onLongPress={onLongPress}
      />,
    );
  }

  // Generic, future-proof fallback for an inner event kind the app doesn't
  // render (#market follow-up). Instead of a blank bubble, show a small muted/
  // italic placeholder naming the raw Nostr kind. Side-aligned like a normal
  // bubble so the sender context (fromMe) is preserved, but visually subdued so
  // it reads as "nothing to do here" rather than a real message.
  if (content.kind === 'unsupported') {
    return (
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <View
          style={[styles.bubble, styles.unsupportedBubble]}
          accessibilityLabel={t('messageBubble.unsupportedA11y', { kind: content.rawKind })}
          testID={`${testIdPrefix}-unsupported-${id}`}
        >
          {SenderLabel}
          <Text style={styles.unsupportedText}>
            {t('messageBubble.unsupportedText', { kind: content.rawKind })}
          </Text>
          {renderFooter([styles.bubbleTime])}
        </View>
      </View>
    );
  }

  if (content.kind === 'pollVote') {
    // Vote events are an internal protocol message — they're rolled up
    // into the referenced poll's tally by the parent's `aggregateVotes`
    // call, so the in-app conversation never shows them as bubbles.
    // Foreign clients (Damus, Amethyst) still see a plain-text bubble
    // because they don't recognise the [POLL_VOTE] prefix; that's an
    // accepted limitation of the text-encoded MVP.
    return null;
  }

  if (content.kind === 'poll') {
    return (
      <PollBubble
        poll={content.poll}
        agg={pollAggregates?.get(id)}
        fromMe={fromMe}
        id={id}
        createdAt={createdAt}
        onVotePoll={onVotePoll}
        testIdPrefix={testIdPrefix}
        styles={styles}
        colors={colors}
        senderLabel={SenderLabel}
      />
    );
  }

  // content.kind === 'text' — fall through to per-text-format detection.
  const text = content.text;

  // Image (#688) — encrypted NIP-17 kind-15 (fetch ciphertext → decrypt →
  // display) OR a plain image URL (legacy / other clients → display directly).
  // Both render through the same bubble; DecryptedImage owns the decrypt path.
  const image = parseImageMessage(text);
  if (image) {
    return wrapWithReactionRow(
      <ImageBubble
        styles={styles}
        image={image}
        fromMe={fromMe}
        senderLabel={SenderLabel}
        onOpenImageFullscreen={onOpenImageFullscreen}
        onLongPress={onLongPress}
        testID={`${testIdPrefix}-image-${id}`}
        footer={renderFooter([styles.imageBubbleTime, fromMe && styles.imageBubbleTimeMe])}
      />,
    );
  }

  // Voice note (#235) — inline player card (play/pause + waveform), shown
  // for both sender and receiver. Detected before the text/link fallback
  // so the Blossom `.mp4` URL renders as a player, not a bare link.
  const voice = parseVoiceNote(text);
  if (voice) {
    return wrapWithReactionRow(
      <VoiceNotePlayer
        url={voice.url}
        encrypted={voice.encrypted}
        keyHex={voice.keyHex}
        nonceHex={voice.nonceHex}
        mime={voice.mime}
        fromMe={fromMe}
        createdAt={createdAt}
        senderName={senderName}
        testID={`${testIdPrefix}-voice-${id}`}
        footer={
          fromMe && deliveryStatus
            ? renderFooter([styles.bubbleTime, fromMe && styles.bubbleTimeMe])
            : undefined
        }
      />,
    );
  }

  // "secretthreewords" magic trigger — render an inline card with a
  // Toggle Secret Mode button. Only LP renders the special UI; on
  // other Nostr clients the recipient sees the plain word and won't
  // know what it does. We render the card on BOTH sides (sender +
  // receiver) so the sender sees a confirmation that the trigger
  // landed, but only the receiver can usefully tap the button —
  // sender's button is harmless (toggles their own mode).
  if (isSecretModeTrigger(text)) {
    return wrapWithReactionRow(
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <Pressable
          onLongPress={onLongPress}
          delayLongPress={350}
          style={[styles.invoiceCard, fromMe ? styles.invoiceCardMe : styles.invoiceCardThem]}
          testID={`${testIdPrefix}-secret-${id}`}
        >
          {SenderLabel}
          <Text style={[styles.invoiceLabel, fromMe && styles.invoiceLabelMe]}>
            {t('messageBubble.secretMode')}
          </Text>
          <Text style={[styles.invoiceMemo, fromMe && styles.invoiceMemoMe]}>
            {fromMe
              ? t('messageBubble.secretModeSenderMemo')
              : t('messageBubble.secretModeReceiverMemo')}
          </Text>
          {!fromMe && onToggleSecretMode && (
            <TouchableOpacity
              style={styles.invoicePayButton}
              onPress={onToggleSecretMode}
              accessibilityRole="button"
              accessibilityLabel={t('messageBubble.toggleSecretMode')}
              testID={`${testIdPrefix}-secret-mode-toggle-${id}`}
            >
              <Text style={styles.invoicePayText}>{t('messageBubble.toggleSecretMode')}</Text>
            </TouchableOpacity>
          )}
          {renderFooter([styles.bubbleTime, fromMe && styles.bubbleTimeMe])}
        </Pressable>
      </View>,
    );
  }

  const bitcoinUri = extractBitcoinUri(text);
  if (bitcoinUri) {
    // On-chain BIP-21 share. Tap → parent's onPayInvoice (which opens
    // SendSheet pre-filled — SendSheet already parses `bitcoin:` URIs
    // and pre-fills both address and BIP-21 amount, so we hand the raw
    // URI straight through). Receiver-only Pay button — outgoing
    // bubbles are informational.
    const shortAddr =
      bitcoinUri.address.length > 16
        ? `${bitcoinUri.address.slice(0, 8)}…${bitcoinUri.address.slice(-6)}`
        : bitcoinUri.address;
    return wrapWithReactionRow(
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <Pressable
          onLongPress={onLongPress}
          delayLongPress={350}
          style={[styles.invoiceCard, fromMe ? styles.invoiceCardMe : styles.invoiceCardThem]}
          testID={`${testIdPrefix}-bitcoin-${id}`}
        >
          {SenderLabel}
          <Text style={[styles.invoiceLabel, fromMe && styles.invoiceLabelMe]}>
            {fromMe ? t('messageBubble.onchainAddressSent') : t('messageBubble.onchainAddress')}
          </Text>
          {bitcoinUri.amountSats !== null ? (
            <Text style={[styles.invoiceAmount, fromMe && styles.invoiceAmountMe]}>
              {t('messageBubble.satsAmount', { amount: bitcoinUri.amountSats.toLocaleString() })}
            </Text>
          ) : null}
          <Text style={[styles.invoiceMemo, fromMe && styles.invoiceMemoMe]} numberOfLines={1}>
            {shortAddr}
          </Text>
          {fromMe ? null : (
            <TouchableOpacity
              style={styles.invoicePayButton}
              onPress={() => onPayInvoice(bitcoinUri.raw)}
              accessibilityRole="link"
              accessibilityLabel={t('messageBubble.payOnchainAddress')}
              testID={`${testIdPrefix}-bitcoin-pay-${id}`}
            >
              <Zap size={16} color={colors.white} fill={colors.white} />
              <Text style={styles.invoicePayText}>{t('messageBubble.pay')}</Text>
            </TouchableOpacity>
          )}
          {renderFooter([styles.bubbleTime, fromMe && styles.bubbleTimeMe])}
        </Pressable>
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
          style={[styles.invoiceCard, fromMe ? styles.invoiceCardMe : styles.invoiceCardThem]}
          testID={`${testIdPrefix}-invoice-${id}`}
        >
          {SenderLabel}
          <Text style={[styles.invoiceLabel, fromMe && styles.invoiceLabelMe]}>
            {fromMe ? t('messageBubble.invoiceSent') : t('messageBubble.invoiceReceived')}
          </Text>
          <Text style={[styles.invoiceAmount, fromMe && styles.invoiceAmountMe]}>
            {invoice.amountSats !== null
              ? t('messageBubble.satsAmount', { amount: invoice.amountSats.toLocaleString() })
              : t('messageBubble.anyAmount')}
          </Text>
          {invoice.description ? (
            <Text style={[styles.invoiceMemo, fromMe && styles.invoiceMemoMe]} numberOfLines={2}>
              {invoice.description}
            </Text>
          ) : null}
          <View style={styles.invoiceTagRow}>
            {paid ? (
              <View
                style={[styles.invoiceTag, styles.invoiceTagPaid]}
                accessibilityLabel={t('messageBubble.invoicePaid')}
                testID={`${testIdPrefix}-paid-badge-${id}`}
              >
                <Text style={styles.invoiceTagPaidText}>{t('messageBubble.paid')}</Text>
              </View>
            ) : expired ? (
              <View style={[styles.invoiceTag, styles.invoiceTagExpired]}>
                <Text style={styles.invoiceTagExpiredText}>{t('messageBubble.expired')}</Text>
              </View>
            ) : fromMe ? (
              <View style={[styles.invoiceTag, styles.invoiceTagUnpaid]}>
                <Text style={styles.invoiceTagUnpaidText}>{t('messageBubble.unpaid')}</Text>
              </View>
            ) : null}
            {!paid && !expired && invoice.expiresAt !== null ? (
              <Text style={[styles.invoiceExpiry, fromMe && styles.invoiceExpiryMe]}>
                {t('messageBubble.expiresIn', {
                  time: formatRelativeFuture(invoice.expiresAt * 1000),
                })}
              </Text>
            ) : null}
          </View>
          {fromMe || paid || expired ? null : (
            <TouchableOpacity
              style={styles.invoicePayButton}
              onPress={() => onPayInvoice(invoice.raw)}
              accessibilityRole="link"
              accessibilityLabel={t('messageBubble.payInvoice')}
              testID={`${testIdPrefix}-pay-${id}`}
            >
              <Zap size={16} color={colors.white} fill={colors.white} />
              <Text style={styles.invoicePayText}>{t('messageBubble.pay')}</Text>
            </TouchableOpacity>
          )}
          {renderFooter([styles.bubbleTime, fromMe && styles.bubbleTimeMe])}
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
          accessibilityLabel={t('messageBubble.sharedContactA11y', { name: displayName })}
          testID={`${testIdPrefix}-contact-${id}`}
        >
          {SenderLabel}
          <Text style={[styles.contactLabel, fromMe && styles.contactLabelMe]}>
            {fromMe ? t('messageBubble.contactShared') : t('messageBubble.contact')}
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
              {prof?.picture && isSupportedImageUrl(prof.picture) ? (
                <ExpoImage
                  source={{ uri: prof.picture }}
                  style={[StyleSheet.absoluteFillObject, { borderRadius: 22 }]}
                  cachePolicy="memory-disk"
                  recyclingKey={prof.picture}
                  autoplay={false}
                />
              ) : null}
            </View>
            <View style={styles.contactInfo}>
              <Text style={[styles.contactName, fromMe && styles.contactNameMe]} numberOfLines={1}>
                {loaded ? displayName : t('messageBubble.loading')}
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
          {renderFooter([styles.bubbleTime, fromMe && styles.bubbleTimeMe])}
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
            {fromMe ? t('messageBubble.addressSent') : t('messageBubble.lightningAddress')}
          </Text>
          <Text style={[styles.invoiceMemo, fromMe && styles.invoiceMemoMe]} numberOfLines={1}>
            {lnAddress}
          </Text>
          {fromMe ? null : (
            <TouchableOpacity
              style={styles.invoicePayButton}
              onPress={() => onPayLightningAddress(lnAddress)}
              accessibilityLabel={t('messageBubble.payLightningAddress')}
              testID={`${testIdPrefix}-pay-${id}`}
            >
              <Zap size={16} color={colors.white} fill={colors.white} />
              <Text style={styles.invoicePayText}>{t('messageBubble.pay')}</Text>
            </TouchableOpacity>
          )}
          {renderFooter([styles.bubbleTime, fromMe && styles.bubbleTimeMe])}
        </Pressable>
      </View>,
    );
  }

  // Plain text fallback — no rich content detected. Cap link previews
  // at 1 per message: first non-blocklisted URL wins. All URLs in the body
  // are rendered as tappable link spans below (see linkifySegments).
  const previewUrl = (() => {
    const urls = extractUrls(text);
    for (const u of urls) {
      if (!isBlocklisted(u)) return u;
    }
    return null;
  })();

  return wrapWithReactionRow(
    <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={350}
        style={[
          styles.bubble,
          fromMe ? styles.bubbleMe : styles.bubbleThem,
          // NIP-04 (kind 4): purple sent bubble (vs pink NIP-17); a purple
          // left-edge on the received surface bubble so legacy DMs are
          // distinguishable on both sides (#856 follow-up).
          isNip04 && (fromMe ? styles.bubbleMeNip04 : styles.bubbleThemNip04),
        ]}
        testID={isNip04 ? `${testIdPrefix}-nip04-bubble-${id}` : `${testIdPrefix}-text-${id}`}
      >
        {SenderLabel}
        <Text style={[styles.bubbleText, fromMe && styles.bubbleTextMe]}>
          {hasLink(text)
            ? linkifySegments(text).map((seg, i) =>
                seg.url ? (
                  <Text
                    key={i}
                    style={[styles.bubbleLink, fromMe && styles.bubbleLinkMe]}
                    onPress={() => {
                      // openURL rejects on a malformed URL / missing handler —
                      // swallow so a bad link can't raise an unhandled rejection.
                      void Linking.openURL(seg.url as string).catch(() => {});
                    }}
                    accessibilityRole="link"
                    accessibilityLabel={t('messageBubble.openLink', { url: seg.url })}
                    testID={`${testIdPrefix}-link-${id}-${i}`}
                  >
                    {seg.text}
                  </Text>
                ) : (
                  seg.text
                ),
              )
            : text}
        </Text>
        {previewUrl ? <MessageLinkPreview url={previewUrl} eventId={id} fromMe={fromMe} /> : null}
        {renderFooter([styles.bubbleTime, fromMe && styles.bubbleTimeMe])}
      </Pressable>
    </View>,
  );
};

export default MessageBubble;
