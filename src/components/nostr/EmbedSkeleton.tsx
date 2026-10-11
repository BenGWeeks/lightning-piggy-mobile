import React from 'react';
import { View } from 'react-native';
import type { NostrContentStyles } from '../../styles/NostrContent.styles';

/** Grey placeholder card shown while an embedded event is being fetched. */
const EmbedSkeleton: React.FC<{ styles: NostrContentStyles; testID?: string }> = ({
  styles,
  testID,
}) => (
  <View style={styles.card} testID={testID ?? 'nostr-embed-skeleton'} accessible={false}>
    <View style={styles.skeletonHeader}>
      <View style={styles.skeletonAvatar} />
      <View style={[styles.skeletonLine, styles.skeletonShort]} />
    </View>
    <View style={[styles.skeletonLine, styles.skeletonLong]} />
    <View style={[styles.skeletonLine, styles.skeletonMid]} />
  </View>
);

export default EmbedSkeleton;
