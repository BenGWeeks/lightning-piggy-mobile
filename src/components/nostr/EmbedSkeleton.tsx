import React from 'react';
import { View } from 'react-native';
import type { NostrContentStyles } from '../../styles/NostrContent.styles';

/** Grey placeholder card shown while an embedded event is being fetched. */
const EmbedSkeleton: React.FC<{
  styles: NostrContentStyles;
  testID?: string;
  /** Shorter placeholder for the compact (reply parent) card. */
  compact?: boolean;
}> = ({ styles, testID, compact = false }) => (
  <View
    style={[styles.card, compact && styles.cardCompact]}
    testID={testID ?? 'nostr-embed-skeleton'}
    accessible={false}
  >
    <View style={styles.skeletonHeader}>
      <View style={styles.skeletonAvatar} />
      <View style={[styles.skeletonLine, styles.skeletonShort]} />
    </View>
    <View style={[styles.skeletonLine, styles.skeletonLong]} />
    {compact ? null : <View style={[styles.skeletonLine, styles.skeletonMid]} />}
  </View>
);

export default EmbedSkeleton;
