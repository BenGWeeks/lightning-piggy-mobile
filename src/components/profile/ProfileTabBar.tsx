import React from 'react';
import { Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from '../../contexts/LocaleContext';
import type { ProfileTab } from '../../utils/profileFeedRows';
import type { ProfileTabsStyles } from '../../styles/ProfileTabs.styles';

const TABS: {
  tab: ProfileTab;
  label: 'profileTabs.posts' | 'profileTabs.media' | 'profileTabs.shop';
}[] = [
  { tab: 'posts', label: 'profileTabs.posts' },
  { tab: 'media', label: 'profileTabs.media' },
  { tab: 'shop', label: 'profileTabs.shop' },
];

interface Props {
  active: ProfileTab;
  onChange: (tab: ProfileTab) => void;
  styles: ProfileTabsStyles;
  /** Extra container style (the pinned copy drops the list copy's margins). */
  style?: StyleProp<ViewStyle>;
  /** testID prefix — the pinned copy uses its own so selectors stay unique. */
  testIDPrefix?: string;
}

/** Posts · Media · Shop tabs on a profile (#1332). */
const ProfileTabBar: React.FC<Props> = ({
  active,
  onChange,
  styles,
  style,
  testIDPrefix = 'profile-tab',
}) => {
  const t = useTranslation();
  return (
    <View style={[styles.tabBar, style]} accessibilityRole="tablist">
      {TABS.map(({ tab, label }) => {
        const selected = tab === active;
        return (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, selected && styles.tabActive]}
            onPress={() => onChange(tab)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={t(label)}
            testID={`${testIDPrefix}-${tab}`}
          >
            <Text style={[styles.tabText, selected && styles.tabTextActive]} numberOfLines={1}>
              {t(label)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

export default React.memo(ProfileTabBar);
