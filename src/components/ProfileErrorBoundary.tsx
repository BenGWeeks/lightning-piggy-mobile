import React, { Component, useMemo } from 'react';
import { Text, View } from 'react-native';
import { UserRound } from 'lucide-react-native';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createProfileErrorBoundaryStyles } from '../styles/ProfileErrorBoundary.styles';

class ProfileGuard extends Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function ProfileErrorBoundary({ children }: { children: React.ReactNode }) {
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createProfileErrorBoundaryStyles(colors), [colors]);
  return (
    <ProfileGuard
      fallback={
        <View style={styles.container} testID="profile-error-fallback">
          <UserRound color={colors.brandPink} size={24} />
          <Text style={styles.text}>{t('profileSafety.unavailable')}</Text>
        </View>
      }
    >
      {children}
    </ProfileGuard>
  );
}
