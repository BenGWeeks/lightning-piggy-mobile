import React, { Component, useMemo } from 'react';
import { Text, View } from 'react-native';
import { UserRound } from 'lucide-react-native';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createProfileErrorBoundaryStyles } from '../styles/ProfileErrorBoundary.styles';

/** Branded "Profile unavailable" card, rendered only once a profile has failed. */
function ProfileFallback() {
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createProfileErrorBoundaryStyles(colors), [colors]);
  return (
    <View style={styles.container} testID="profile-error-fallback">
      <UserRound color={colors.brandPink} size={24} />
      <Text style={styles.text}>{t('profileSafety.unavailable')}</Text>
    </View>
  );
}

/**
 * Contains a render error from one profile card / list row so a malformed
 * kind-0 can never blank the whole screen (#1500 M3). Theme / locale hooks
 * live in the fallback only: a healthy row (hundreds in a contact list) pays
 * no extra context subscriptions for being guarded.
 */
export default class ProfileErrorBoundary extends Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    if (__DEV__) console.warn('[ProfileErrorBoundary] profile render failed:', error);
  }

  render() {
    return this.state.failed ? <ProfileFallback /> : this.props.children;
  }
}
