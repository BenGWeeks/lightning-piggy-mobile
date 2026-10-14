import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  BackHandler,
  type ScrollViewProps,
} from 'react-native';
import { KeyboardAvoidingView, KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import BrandGradientBackground from '../../components/BrandGradientBackground';
import { useTranslation } from '../../contexts/LocaleContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import { createAccountScreenLayoutStyles } from '../../styles/AccountScreenLayout.styles';
import type { AccountDrawerNavigation, AccountDrawerParamList } from '../../navigation/types';

interface Props {
  title: string;
  children: React.ReactNode;
  scrollViewProps?: Omit<ScrollViewProps, 'contentContainerStyle' | 'style'>;
  // Set false when the screen's primary content is already a scrollable
  // surface (e.g. FlatList) — avoids nesting VirtualizedLists inside a
  // ScrollView, which breaks list windowing and triggers an RN warning.
  scrollable?: boolean;
  // For a sub-page of another settings screen (e.g. the currency picker under
  // Display & language): back — the chevron and Android's back gesture —
  // returns here instead of to the tabs. Drawer routes are siblings, so the
  // drawer's own back would skip the parent.
  parent?: Exclude<keyof AccountDrawerParamList, 'MainTabs'>;
}

/**
 * Shared chrome for every AccountStack sub-screen: pink background,
 * background art, and a fixed header (back chevron + title) below the
 * status bar. Content scrolls *beneath* the header, so it never slides under
 * the clock and status icons (#1552). Each section screen renders its
 * content inside the scroll view, unless `scrollable={false}` is passed (in
 * which case the screen owns its own scroll surface and the layout only
 * renders the chrome).
 */
const AccountScreenLayout: React.FC<Props> = ({
  title,
  children,
  scrollViewProps,
  scrollable = true,
  parent,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createAccountScreenLayoutStyles(colors), [colors]);
  const navigation = useNavigation<AccountDrawerNavigation>();
  const insets = useSafeAreaInsets();

  const goBack = useCallback(() => {
    if (parent) navigation.navigate(parent);
    else navigation.goBack();
  }, [navigation, parent]);

  useFocusEffect(
    useCallback(() => {
      if (!parent) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        navigation.navigate(parent);
        return true;
      });
      return () => sub.remove();
    }, [navigation, parent]),
  );

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
      <TouchableOpacity
        accessibilityRole="button"
        style={styles.backButton}
        onPress={goBack}
        accessibilityLabel={t('accountScreenLayout.back')}
        testID="account-back-button"
      >
        <ChevronLeft size={24} color={colors.brandPink} />
      </TouchableOpacity>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
  // Bottom inset + a little air, so the last row clears 3-button / gesture
  // navigation and can always be scrolled fully into view.
  const bottomPad = { paddingBottom: insets.bottom + 24 };

  return (
    <View style={styles.container}>
      <BrandGradientBackground />
      <Image
        source={require('../../../assets/images/nostrich.png')}
        style={styles.bgImage}
        resizeMode="contain"
      />
      {header}
      {/* Edge-to-edge: the window never resizes for the keyboard. These
          keyboard-controller views follow the live keyboard height instead of
          RN's KeyboardAvoidingView, whose measured height can go stale on the
          drawer's still-mounted screens and leave the bottom cut off. */}
      {scrollable ? (
        <KeyboardAwareScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, bottomPad]}
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
          // Android: keep the scrollbar visible when there's more below.
          persistentScrollbar
          {...scrollViewProps}
        >
          {children}
        </KeyboardAwareScrollView>
      ) : (
        // The keyboard padding is animated onto the outer view (it replaces any
        // paddingBottom there), so the safe-area padding lives on the inner one.
        <KeyboardAvoidingView behavior="padding" style={styles.flex}>
          <View style={[styles.content, styles.flex, bottomPad]}>{children}</View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
};

export default AccountScreenLayout;
