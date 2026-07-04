import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { formatCoordsForDisplay, type SharedLocation } from '../services/locationService';
import type { BtcMapPlace } from '../services/btcMapService';
import type { ParsedCache, ParsedEvent } from '../services/nostrPlacesService';
import LibreMiniMap from './LibreMiniMap';
import type { MessageBubbleStyles } from '../styles/MessageBubble.styles';

// Stable empty arrays for the mini-map — LibreMiniMap only plots the shared
// point + optional "me"/peer dots, never merchants/caches/events, but its API
// requires the arrays. Module scope so identity is stable across renders.
const EMPTY_MERCHANTS: BtcMapPlace[] = [];
const EMPTY_CACHES: ParsedCache[] = [];
const EMPTY_EVENTS: ParsedEvent[] = [];

interface LocationBubbleProps {
  location: SharedLocation;
  fromMe: boolean;
  id: string;
  testIdPrefix: string;
  styles: MessageBubbleStyles;
  /** Sender name label (group incoming bubbles only); null otherwise. */
  senderLabel: React.ReactNode;
  /** Pre-rendered footer (timestamp + delivery tick). */
  footer: React.ReactNode;
  myLat?: number | null;
  myLon?: number | null;
  myAccuracyMetres?: number | null;
  myAvatarUri?: string | null;
  peerAvatarUri?: string | null;
  onOpenLocation: (location: SharedLocation) => void;
  onOpenMap?: () => void;
  onLongPress?: () => void;
}

/**
 * The static shared-location card (#206). Extracted from MessageBubble so that
 * file stays under the #703 size cap — pure presentation of a single shared
 * point on a mini-map. The live-location variant stays inline in MessageBubble
 * (it carries session status/countdown state); this is the snapshot-only card.
 */
export function LocationBubble({
  location,
  fromMe,
  id,
  testIdPrefix,
  styles,
  senderLabel,
  footer,
  myLat,
  myLon,
  myAccuracyMetres,
  myAvatarUri,
  peerAvatarUri,
  onOpenLocation,
  onOpenMap,
  onLongPress,
}: LocationBubbleProps) {
  const colors = useThemeColors();
  const t = useTranslation();
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
        onLongPress={onLongPress}
        delayLongPress={350}
        style={[styles.locationCard, fromMe ? styles.locationCardMe : styles.locationCardThem]}
        accessibilityLabel={
          fromMe ? t('messageBubble.locationSent') : t('messageBubble.locationReceived')
        }
        testID={`${testIdPrefix}-location-${id}`}
      >
        {senderLabel}
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
            userAvatarUri={showMyDot ? (myAvatarUri ?? null) : null}
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
              {fromMe ? t('messageBubble.locationSent') : t('messageBubble.locationLabel')}
            </Text>
          </View>
          <Text style={[styles.locationCoords, fromMe && styles.locationCoordsMe]}>
            {formatCoordsForDisplay(location)}
          </Text>
          {location.accuracyMeters !== null ? (
            <Text style={[styles.locationAccuracy, fromMe && styles.locationAccuracyMe]}>
              {t('messageBubble.accuracyOsm', { meters: location.accuracyMeters })}
            </Text>
          ) : (
            <Text style={[styles.locationAccuracy, fromMe && styles.locationAccuracyMe]}>
              OpenStreetMap
            </Text>
          )}
          {footer}
        </View>
      </TouchableOpacity>
    </View>
  );
}

export default LocationBubble;
