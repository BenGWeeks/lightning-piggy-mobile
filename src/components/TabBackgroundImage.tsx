import React from 'react';
import { Image, type ImageStyle } from 'expo-image';
import type { StyleProp } from 'react-native';

interface Props {
  style: StyleProp<ImageStyle>;
}

/**
 * The faint pink piggy-pattern that sits behind the Friends and Messages
 * tab list areas. Extracted so both screens share one source of truth
 * for the cache hint + decoder choice — without this, the rationale
 * comment was duplicated verbatim across the two tabs and the next
 * person to touch one would inevitably forget the other.
 *
 * Why `expo-image` (vs stock RN `Image`) and `cachePolicy="memory-disk"`:
 * the underlying asset is 754 KB at 600×600. Stock RN `Image` decodes
 * on the UI thread on every cold tab mount, contributing the dominant
 * share of the ~5 s GPU stall measured on AVD before this swap landed.
 * `expo-image` decodes off the UI thread via Glide and persists the
 * decoded bitmap on disk, so the second tab visit (or a warm app start)
 * skips the decode entirely. See issue #245.
 *
 * `contentFit="contain"` mirrors the previous `resizeMode="contain"`
 * — same visual.
 */
const TabBackgroundImage: React.FC<Props> = ({ style }) => (
  <Image
    source={require('../../assets/images/friends-bg.png')}
    style={style}
    contentFit="contain"
    cachePolicy="memory-disk"
  />
);

export default TabBackgroundImage;
