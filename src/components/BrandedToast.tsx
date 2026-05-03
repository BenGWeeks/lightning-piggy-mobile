// Brand-themed wrapper around `react-native-toast-message`.
//
// Same drop-in API as the underlying lib (`Toast.show({ type, text1, text2 })`)
// — we just re-skin the render slot so toasts match the app's pink/blue
// palette and round-corner / shadow language used by BrandedAlert
// (PR #234 / #276).
//
// Why a wrapper instead of inlining `<Toast config={...}>` in App.tsx:
//   - Single source of truth for styling. Future colour / shadow tweaks
//     live in one file rather than scattered through App.tsx.
//   - ESLint `no-restricted-imports` rule (see eslint.config.js) blocks
//     direct imports of `react-native-toast-message` outside this file,
//     so new call sites can't accidentally bypass the brand styling.
//
// Behavioural rules:
//   - Position / duration / stacking unchanged from the library defaults
//     (callers control these via Toast.show({...}) options as before).
//   - Long-text rendering unchanged: text1 still 2 lines, text2 unlimited
//     with grow-to-fit min-height — preserves the long-error rendering
//     that App.tsx previously configured (e.g. Electrum script-verify
//     error messages don't get truncated).
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import RNToast, {
  BaseToast,
  ErrorToast,
  InfoToast,
  type BaseToastProps,
} from 'react-native-toast-message';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

// Re-export the lib's `Toast` default so call sites just swap their import
// path and keep using `Toast.show(...)` / `Toast.hide()` exactly as before.
export const Toast = RNToast;
export default Toast;

// Style overrides applied to every toast variant — keeps proportions
// consistent with BrandedAlert's card (28px radius, soft shadow).
// 14px radius is a softer match to the toast slot's smaller footprint
// than the alert card's 28px.
const sharedToastStyle = {
  height: undefined as number | undefined,
  minHeight: 60,
  paddingVertical: 10,
  borderRadius: 14,
  borderLeftWidth: 6,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.18,
  shadowRadius: 12,
  elevation: 6,
};

// Factory so each variant can stamp in its accent colour without
// duplicating layout / typography overrides.
function makeToastConfig(colors: Palette) {
  const text1Style = { fontSize: 15, fontWeight: '700' as const, color: colors.textHeader };
  const text2Style = { fontSize: 13, color: colors.textBody, flexWrap: 'wrap' as const };

  return {
    // Success → brand pink accent. (Dev builds swap brandPink → blue via
    // the palette's __DEV__ flag, so dev variants visibly diverge from
    // production at the toast level too.)
    success: (props: BaseToastProps) => (
      <BaseToast
        {...props}
        text1NumberOfLines={2}
        text2NumberOfLines={0}
        style={[
          props.style,
          sharedToastStyle,
          { borderLeftColor: colors.brandPink, backgroundColor: colors.surface },
        ]}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        text1Style={text1Style}
        text2Style={text2Style}
      />
    ),
    // Info → brand pink accent (matches BrandedAlert's info treatment,
    // which also uses brandPink as the chrome colour for non-error states).
    info: (props: BaseToastProps) => (
      <InfoToast
        {...props}
        text1NumberOfLines={2}
        text2NumberOfLines={0}
        style={[
          props.style,
          sharedToastStyle,
          { borderLeftColor: colors.brandPink, backgroundColor: colors.surface },
        ]}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        text1Style={text1Style}
        text2Style={text2Style}
      />
    ),
    // Error stays red — destructive state should remain visually distinct
    // from positive ones. Same rounded corners + shadow so it still feels
    // like a sibling of success / info instead of a different component.
    error: (props: BaseToastProps) => (
      <ErrorToast
        {...props}
        text1NumberOfLines={2}
        text2NumberOfLines={0}
        style={[
          props.style,
          sharedToastStyle,
          { borderLeftColor: colors.red, backgroundColor: colors.surface },
        ]}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        text1Style={text1Style}
        text2Style={text2Style}
      />
    ),
  };
}

// Mount component — drops into App.tsx as `<BrandedToast />`, replacing
// the old `<Toast config={...}>`. Reads the live theme palette so toasts
// re-skin instantly when the user toggles light / dark.
export function BrandedToast(): React.ReactElement {
  const colors = useThemeColors();
  const config = useMemo(() => makeToastConfig(colors), [colors]);
  return <RNToast topOffset={60} config={config} />;
}

// Fallback BaseToast renderer for callers that pass an unrecognised
// `type` — keeps them on-brand instead of silently dropping the toast.
// Not currently used by any call site but cheap to provide.
export function GenericBrandedToast({
  text1,
  text2,
  accent,
}: {
  text1: string;
  text2?: string;
  accent?: string;
}): React.ReactElement {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.card, { borderLeftColor: accent ?? colors.brandPink }]}>
      <Text style={styles.text1}>{text1}</Text>
      {text2 ? <Text style={styles.text2}>{text2}</Text> : null}
    </View>
  );
}

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderLeftWidth: 6,
      paddingVertical: 12,
      paddingHorizontal: 16,
      width: 340,
      minHeight: 60,
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 12,
      elevation: 6,
    },
    text1: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textHeader,
    },
    text2: {
      fontSize: 13,
      color: colors.textBody,
      marginTop: 2,
    },
  });
