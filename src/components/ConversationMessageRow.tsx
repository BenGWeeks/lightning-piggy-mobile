import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Zap } from 'lucide-react-native';
import MessageBubble from './MessageBubble';
import type { TransactionDetailData } from './TransactionDetailSheet';
import type { Palette } from '../styles/palettes';
import type { ConversationStyles } from '../styles/ConversationScreen.styles';
import type { Item } from '../utils/conversationItems';
import { formatTime } from '../utils/messageContent';

// Reuse MessageBubble's own prop types so the pass-through handlers can never
// drift from what the bubble expects.
type BubbleProps = React.ComponentProps<typeof MessageBubble>;

export interface ConversationMessageRowProps {
  item: Item;
  styles: ConversationStyles;
  colors: Palette;
  sharedProfiles: BubbleProps['sharedProfiles'];
  isInvoicePaid: BubbleProps['isInvoicePaid'];
  onPayInvoice: BubbleProps['onPayInvoice'];
  onOpenContact: BubbleProps['onOpenContact'];
  onOpenLocation: BubbleProps['onOpenLocation'];
  onOpenGifFullscreen: BubbleProps['onOpenGifFullscreen'];
  onToggleSecretMode: BubbleProps['onToggleSecretMode'];
  onShowTxDetail: (tx: TransactionDetailData) => void;
  // Live-location pass-throughs (#206) — latest coords / status / countdown
  // per session, plus the in-bubble "Stop" handler for the sender.
  liveLocationLatest: BubbleProps['liveLocationLatest'];
  liveLocationStatus: BubbleProps['liveLocationStatus'];
  liveLocationRemainingMs: BubbleProps['liveLocationRemainingMs'];
  onStopLiveLocation: BubbleProps['onStopLiveLocation'];
  // Location-card mini-map plumbing (#206) — my live position (for the
  // blue "me" dot + halo), the peer's avatar, and the Open-Map handler.
  myLat: BubbleProps['myLat'];
  myLon: BubbleProps['myLon'];
  myAccuracyMetres: BubbleProps['myAccuracyMetres'];
  myAvatarUri: BubbleProps['myAvatarUri'];
  peerAvatarUri: BubbleProps['peerAvatarUri'];
  onOpenMap: BubbleProps['onOpenMap'];
  // Long-press a sent bubble → parent presents the per-relay delivery
  // breakdown (#856). Passed straight through to MessageBubble.
  onShowDelivery: BubbleProps['onShowDelivery'];
}

/**
 * One row of the 1:1 ConversationScreen FlatList. Extracted from the screen's
 * inline `renderItem` to keep the screen under the #703 size cap. Renders the
 * day-header rule, the wallet-derived zap card (1:1-only — groups don't pair
 * zap receipts to a single peer), or a MessageBubble for text/gif/location.
 */
function ConversationMessageRow({
  item,
  styles,
  colors,
  sharedProfiles,
  isInvoicePaid,
  onPayInvoice,
  onOpenContact,
  onOpenLocation,
  onOpenGifFullscreen,
  onToggleSecretMode,
  onShowTxDetail,
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
  onShowDelivery,
}: ConversationMessageRowProps): React.ReactElement {
  if (item.kind === 'dayHeader') {
    return (
      <View style={styles.dayHeaderRow}>
        <View style={styles.dayHeaderRule} />
        <Text style={styles.dayHeaderText}>{item.label}</Text>
        <View style={styles.dayHeaderRule} />
      </View>
    );
  }
  // Wallet-derived zap variant — Lightning tx pulled from the wallet's
  // ledger, NOT a Nostr message. Stays here because it's the only
  // 1:1-specific Item kind: groups don't pair zap receipts to a single
  // peer, so MessageBubble doesn't carry this case.
  if (item.kind === 'zap') {
    return (
      <View style={[styles.zapRow, item.fromMe ? styles.zapRowRight : styles.zapRowLeft]}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => onShowTxDetail(item.tx)}
          style={[styles.zapCard, item.fromMe ? styles.zapCardMe : styles.zapCardThem]}
          accessibilityLabel={item.fromMe ? 'Zap sent' : 'Zap received'}
          testID={`conversation-zap-${item.id}`}
        >
          <View
            style={[
              styles.zapCardIconBadge,
              item.fromMe ? styles.zapCardIconBadgeMe : styles.zapCardIconBadgeThem,
            ]}
          >
            <Zap
              size={18}
              color={item.fromMe ? colors.brandPink : colors.white}
              fill={item.fromMe ? colors.brandPink : colors.white}
            />
          </View>
          <View style={styles.zapCardBody}>
            <Text style={[styles.zapCardLabel, item.fromMe && styles.zapCardLabelMe]}>
              {item.fromMe ? 'Zap sent' : 'Zap received'}
            </Text>
            <Text style={[styles.zapCardAmount, item.fromMe && styles.zapCardAmountMe]}>
              {item.amountSats.toLocaleString()} sats
            </Text>
            {item.comment ? (
              <Text style={[styles.zapCardComment, item.fromMe && styles.zapCardCommentMe]}>
                {item.comment}
              </Text>
            ) : null}
            <Text style={[styles.bubbleTime, item.fromMe && styles.bubbleTimeMe]}>
              {formatTime(item.createdAt)}
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    );
  }
  // Map the local Item shape to MessageBubble's `BubbleContent`. The Items
  // array was already classified upstream (buildConversationItems calls
  // classifyMessageContent) so this is a flat re-tag — MessageBubble handles
  // the remaining text-format detection (image / invoice / lnaddr / contact).
  const content =
    item.kind === 'gif'
      ? ({ kind: 'gif', url: item.url } as const)
      : item.kind === 'location'
        ? ({ kind: 'location', location: item.location } as const)
        : item.kind === 'liveLocationMarker'
          ? ({ kind: 'liveLocationMarker', marker: item.marker } as const)
          : ({ kind: 'text', text: item.text } as const);
  return (
    <MessageBubble
      id={item.id}
      fromMe={item.fromMe}
      createdAt={item.createdAt}
      content={content}
      sharedProfiles={sharedProfiles}
      isInvoicePaid={isInvoicePaid}
      onPayInvoice={onPayInvoice}
      onPayLightningAddress={onPayInvoice}
      onOpenContact={onOpenContact}
      onOpenLocation={onOpenLocation}
      onOpenGifFullscreen={onOpenGifFullscreen}
      onToggleSecretMode={onToggleSecretMode}
      liveLocationLatest={liveLocationLatest}
      liveLocationStatus={liveLocationStatus}
      liveLocationRemainingMs={liveLocationRemainingMs}
      onStopLiveLocation={onStopLiveLocation}
      myLat={myLat}
      myLon={myLon}
      myAccuracyMetres={myAccuracyMetres}
      myAvatarUri={myAvatarUri}
      peerAvatarUri={peerAvatarUri}
      onOpenMap={onOpenMap}
      deliveryStatus={item.kind === 'message' ? item.deliveryStatus : undefined}
      onShowDelivery={onShowDelivery}
      testIdPrefix="conversation"
    />
  );
}

export default React.memo(ConversationMessageRow);
