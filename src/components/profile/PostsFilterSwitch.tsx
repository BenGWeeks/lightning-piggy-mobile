import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from '../../contexts/LocaleContext';
import type { PostsMode } from '../../utils/profileFeedRows';
import type { ProfileTabsStyles } from '../../styles/ProfileTabs.styles';

const OPTIONS: {
  mode: PostsMode;
  label: 'profileTabs.filterPosts' | 'profileTabs.filterPostsAndReplies';
  testID: string;
}[] = [
  { mode: 'posts', label: 'profileTabs.filterPosts', testID: 'profile-posts-filter-posts' },
  {
    mode: 'all',
    label: 'profileTabs.filterPostsAndReplies',
    testID: 'profile-posts-filter-replies',
  },
];

interface Props {
  mode: PostsMode;
  onChange: (mode: PostsMode) => void;
  styles: ProfileTabsStyles;
}

/**
 * Compact segmented switch at the top of the Posts tab (#1332): top-level
 * "Posts" (default) or "Posts & replies". A switch rather than a fourth tab.
 */
const PostsFilterSwitch: React.FC<Props> = ({ mode, onChange, styles }) => {
  const t = useTranslation();
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {OPTIONS.map((o) => {
        const selected = o.mode === mode;
        return (
          <TouchableOpacity
            key={o.mode}
            style={[styles.segment, selected && styles.segmentActive]}
            onPress={() => onChange(o.mode)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={t(o.label)}
            testID={o.testID}
          >
            <Text
              style={[styles.segmentText, selected && styles.segmentTextActive]}
              numberOfLines={1}
            >
              {t(o.label)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

export default React.memo(PostsFilterSwitch);
