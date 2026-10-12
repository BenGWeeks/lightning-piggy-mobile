import React from 'react';
import { Text, View } from 'react-native';
import ProfileTabBar from './ProfileTabBar';
import type { ProfileTab } from '../../utils/profileFeedRows';
import type { ProfileStickyPhase } from '../../utils/profileHeaderLayout';
import type { ProfileTabsStyles } from '../../styles/ProfileTabs.styles';

interface Props {
  phase: ProfileStickyPhase;
  topInset: number;
  title: string;
  showTabs: boolean;
  tab: ProfileTab;
  onChangeTab: (tab: ProfileTab) => void;
  styles: ProfileTabsStyles;
}

/**
 * The profile page's pinned app bar (#1332 review). Once the banner has
 * scrolled away it paints a solid bar from the top of the screen — covering
 * the status bar / display cutout via the safe-area inset — down past the
 * floating back / ⋯ buttons (which stay above it), titled with the person's
 * name. When the in-list tab bar reaches it, a copy of the tab bar is pinned
 * directly below the buttons, so tabs never sit under the clock or the
 * buttons. Rendered by ContactProfileScreen above the list, below the
 * buttons.
 */
const ProfileStickyBar: React.FC<Props> = ({
  phase,
  topInset,
  title,
  showTabs,
  tab,
  onChangeTab,
  styles,
}) => {
  if (phase === 0) return null;
  return (
    <View style={[styles.stickyBar, { paddingTop: topInset }]} testID="profile-sticky-bar">
      <View style={styles.stickyTitleRow}>
        <Text style={styles.stickyTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {phase === 2 && showTabs ? (
        <ProfileTabBar
          active={tab}
          onChange={onChangeTab}
          styles={styles}
          style={styles.stickyTabBar}
          testIDPrefix="profile-sticky-tab"
        />
      ) : null}
    </View>
  );
};

export default React.memo(ProfileStickyBar);
