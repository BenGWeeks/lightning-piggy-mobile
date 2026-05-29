import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Zap, MapPin, UserRound, Radio } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
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
import { isSupportedImageUrl } from '../utils/imageUrl';
import { extractUrls } from '../utils/extractUrls';
import { linkifySegments, hasLink } from '../utils/linkify';
import { isBlocklisted } from '../services/linkPreviewBlocklist';
import MessageLinkPreview from './MessageLinkPreview';
import VoiceNotePlayer from './VoiceNotePlayer';
import DecryptedImage from './DecryptedImage';
import LibreMiniMap from './LibreMiniMap';

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
  // Tapping the "Toggle Secret Mode" button on the magic-trigger card
  // (when the message body is exactly "secretthreewords"). Parent
  // owns the secretMode setter + celebration overlay so a list of
  // cells doesn't each render their own confetti instance.
  onToggleSecretMode?: () => void;
  // Test-id prefix lets 1:1 and group bubbles coexist in the same Maestro
  // run with stable selectors. e.g. `conversation` → `conversation-pay-…`.
  testIdPrefix: string;
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
  createdAt: number;
  senderLabel: React.ReactNode;
  onOpenImageFullscreen?: (url: string) => void;
  testID: string;
}> = ({ styles, image, fromMe, createdAt, senderLabel, onOpenImageFullscreen, testID }) => {
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
        style={[styles.imageBubble, fromMe ? styles.imageBubbleMe : styles.imageBubbleThem]}
        accessibilityLabel={fromMe ? 'Image sent' : 'Image received'}
        accessibilityRole={canOpen ? 'imagebutton' : 'image'}
        disabled={!canOpen}
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
          accessibilityLabel="Shared image"
          onResolved={image.encrypted ? setDisplayUri : undefined}
        />
        <Text style={[styles.imageBubbleTime, fromMe && styles.imageBubbleTimeMe]}>
          {formatTime(createdAt)}
        </Text>
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
  onToggleSecretMode,
  testIdPrefix,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createMessageBubbleStyles(colors), [colors]);

  // Sender label only renders on group bubbles for incoming messages —
  // identical to existing GroupConversationScreen behaviour. Pulled into
  // a single render slot so every variant gets it for free.
  const SenderLabel = senderName ? <Text style={styles.senderLabel}>{senderName}</Text> : null;

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
          <Text style={[styles.gifTime, fromMe && styles.gifTimeMe]}>{formatTime(createdAt)}</Text>
        </TouchableOpacity>
      </View>
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
      status === 'ended'
        ? 'Live location ended'
        : status === 'paused'
          ? fromMe
            ? 'Live location paused'
            : 'Live location · paused'
          : fromMe
            ? 'Sharing live location'
            : 'Live location';
    const subtitleText: string | null = (() => {
      if (status === 'ended') {
        return latest ? `Last update ${formatTime(Math.floor(latest.ts / 1000))}` : null;
      }
      if (latest) {
        const ageMs = Math.max(0, Date.now() - latest.ts);
        const mins = Math.floor(ageMs / 60_000);
        const secs = Math.floor((ageMs % 60_000) / 1000);
        if (mins >= 1) return `Updated ${mins}m ago`;
        return `Updated ${secs}s ago`;
      }
      return 'Waiting for first update…';
    })();
    const remainingLabel: string | null = (() => {
      if (status === 'ended') return null;
      if (remaining === null) return null;
      if (remaining <= 0) return 'Ending…';
      const mins = Math.ceil(remaining / 60_000);
      if (mins < 60) return `${mins} min left`;
      const hours = Math.floor(mins / 60);
      const remMin = mins % 60;
      return remMin === 0 ? `${hours}h left` : `${hours}h ${remMin}m left`;
    })();
    return (
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => displayLocation && onOpenLocation(displayLocation)}
          style={[styles.locationCard, fromMe ? styles.locationCardMe : styles.locationCardThem]}
          accessibilityLabel={
            fromMe
              ? `Sharing live location with peer, ${remainingLabel ?? 'no time remaining'}`
              : `Receiving live location, ${subtitleText ?? 'waiting'}`
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
                accessibilityLabel="Stop sharing live location"
                testID={`${testIdPrefix}-live-location-stop-${id}`}
              >
                <Text style={styles.invoicePayText}>Stop sharing</Text>
              </TouchableOpacity>
            ) : null}
            <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
              {formatTime(createdAt)}
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  if (content.kind === 'location') {
    const { location } = content;
    const haveMine = typeof myLat === 'number' && typeof myLon === 'number';
    // My blue dot only on a received static card — not on my own share
    // (a static share is a single point, my live position is irrelevant).
    const showMyDot = !fromMe && haveMine;
    // Peer avatar marker only on a received card, at the shared point.
    // `peerAvatarUri !== undefined` scopes the chip to the 1:1 path —
    // group bubbles pass no avatar plumbing (#206 group follow-up).
    const peerMarker =
      !fromMe && peerAvatarUri !== undefined
        ? { lat: location.lat, lon: location.lon, avatarUri: peerAvatarUri ?? null }
        : null;
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
          <View style={styles.locationMap}>
            <LibreMiniMap
              lat={location.lat}
              lon={location.lon}
              merchants={EMPTY_MERCHANTS}
              caches={EMPTY_CACHES}
              events={EMPTY_EVENTS}
              fill
              defaultZoom={15}
              userLat={showMyDot ? (myLat ?? null) : null}
              userLon={showMyDot ? (myLon ?? null) : null}
              userAccuracyMetres={showMyDot ? (myAccuracyMetres ?? null) : null}
              profileMarker={peerMarker}
              onTapMap={onOpenMap}
            />
          </View>
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
      </View>
    );
  }

  // content.kind === 'text' — fall through to per-text-format detection.
  const text = content.text;

  // Image (#688) — encrypted NIP-17 kind-15 (fetch ciphertext → decrypt →
  // display) OR a plain image URL (legacy / other clients → display directly).
  // Both render through the same bubble; DecryptedImage owns the decrypt path.
  const image = parseImageMessage(text);
  if (image) {
    return (
      <ImageBubble
        styles={styles}
        image={image}
        fromMe={fromMe}
        createdAt={createdAt}
        senderLabel={SenderLabel}
        onOpenImageFullscreen={onOpenImageFullscreen}
        testID={`${testIdPrefix}-image-${id}`}
      />
    );
  }

  // Voice note (#235) — inline player card (play/pause + waveform), shown
  // for both sender and receiver. Detected before the text/link fallback
  // so the Blossom `.mp4` URL renders as a player, not a bare link.
  const voice = parseVoiceNote(text);
  if (voice) {
    return (
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
      />
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
    return (
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <View style={[styles.invoiceCard, fromMe ? styles.invoiceCardMe : styles.invoiceCardThem]}>
          {SenderLabel}
          <Text style={[styles.invoiceLabel, fromMe && styles.invoiceLabelMe]}>Secret Mode</Text>
          <Text style={[styles.invoiceMemo, fromMe && styles.invoiceMemoMe]}>
            {fromMe
              ? 'Lightning Piggy will offer the recipient a button to toggle Secret Mode.'
              : 'Unlocks dev / power-user surfaces in Lightning Piggy.'}
          </Text>
          {!fromMe && onToggleSecretMode && (
            <TouchableOpacity
              style={styles.invoicePayButton}
              onPress={onToggleSecretMode}
              accessibilityRole="button"
              accessibilityLabel="Toggle Secret Mode"
              testID={`${testIdPrefix}-secret-mode-toggle-${id}`}
            >
              <Text style={styles.invoicePayText}>Toggle Secret Mode</Text>
            </TouchableOpacity>
          )}
          <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
            {formatTime(createdAt)}
          </Text>
        </View>
      </View>
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
    return (
      <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <View style={[styles.invoiceCard, fromMe ? styles.invoiceCardMe : styles.invoiceCardThem]}>
          {SenderLabel}
          <Text style={[styles.invoiceLabel, fromMe && styles.invoiceLabelMe]}>
            {fromMe ? 'On-chain address sent' : 'On-chain address'}
          </Text>
          {bitcoinUri.amountSats !== null ? (
            <Text style={[styles.invoiceAmount, fromMe && styles.invoiceAmountMe]}>
              {bitcoinUri.amountSats.toLocaleString()} sats
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
              accessibilityLabel="Pay this on-chain address"
              testID={`${testIdPrefix}-bitcoin-pay-${id}`}
            >
              <Zap size={16} color={colors.white} fill={colors.white} />
              <Text style={styles.invoicePayText}>Pay</Text>
            </TouchableOpacity>
          )}
          <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
            {formatTime(createdAt)}
          </Text>
        </View>
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
              <View
                style={[styles.invoiceTag, styles.invoiceTagPaid]}
                accessibilityLabel="Invoice paid"
                testID={`${testIdPrefix}-paid-badge-${id}`}
              >
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
              accessibilityRole="link"
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
          <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
            {formatTime(createdAt)}
          </Text>
        </View>
      </View>
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

  return (
    <View style={[styles.bubbleRow, fromMe ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
      <View style={[styles.bubble, fromMe ? styles.bubbleMe : styles.bubbleThem]}>
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
                    accessibilityLabel={`Open link ${seg.url}`}
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
        <Text style={[styles.bubbleTime, fromMe && styles.bubbleTimeMe]}>
          {formatTime(createdAt)}
        </Text>
      </View>
    </View>
  );
};

export default MessageBubble;
