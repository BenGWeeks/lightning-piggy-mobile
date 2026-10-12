import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { CalendarDays } from 'lucide-react-native';
import type { ParsedEvent } from '../services/nostrPlacesService';
import type { Palette } from '../styles/palettes';
import { createExploreHomeRailStyles } from '../styles/ExploreHomeRail.styles';
import { formatDistance } from '../utils/geohash';

const ExploreEventCard: React.FC<{
  event: ParsedEvent;
  locale: string;
  distance: number;
  onPress: () => void;
  colors: Palette;
  styles: ReturnType<typeof createExploreHomeRailStyles>;
}> = ({ event, distance, onPress, colors, styles, locale }) => {
  const day = event.startsAt
    ? new Date(event.startsAt * 1000).toLocaleString(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : 'Soon';
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} testID={`event-card-${event.d}`}>
      {event.imageUrl ? (
        <Image
          source={{ uri: event.imageUrl }}
          style={styles.cardThumb}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.cardThumb, styles.cardThumbPlaceholder, styles.cardIconEvent]}>
          <CalendarDays size={32} color={colors.white} strokeWidth={2} />
        </View>
      )}
      <Text style={styles.cardTitle} numberOfLines={2}>
        {event.title}
      </Text>
      <Text style={styles.cardSub} numberOfLines={1}>
        {day}
        {Number.isFinite(distance) ? ` · ${formatDistance(distance)}` : ''}
      </Text>
      {event.location ? (
        <Text style={styles.cardSubSmall} numberOfLines={1}>
          {event.location}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
};

export default React.memo(ExploreEventCard);
