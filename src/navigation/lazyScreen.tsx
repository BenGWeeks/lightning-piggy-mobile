import React, { Suspense } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';

/**
 * Defer Hermes module evaluation for screens that are only reachable via a
 * stack push (never a tab root), so the ~35 screen modules AppNavigator used
 * to `import` statically no longer all parse before the first frame (audit
 * HIGH 1 — measured ~2.7–2.9 s of cold-start parse).
 *
 * `lazyScreen(() => import('../screens/Foo'))` returns a component usable
 * directly as a `Stack.Screen`/`ExploreStack.Screen` `component=` prop. The
 * underlying chunk is fetched + evaluated the first time React Navigation
 * mounts the screen (i.e. on first navigate to it, including imperative
 * deep-link `navigationRef.navigate(...)` routes), with a themed
 * `ActivityIndicator` shown via a per-screen `Suspense` boundary while the
 * import resolves. A per-screen boundary (rather than one above the whole
 * navigator) means a slow chunk only shows the spinner for that one screen and
 * never tears down sibling screens — keeping `freezeOnBlur` + persisted
 * navigation state intact.
 *
 * Tab-root screens (Home / Messages / Explore-home / Friends + the account
 * drawer roots) are deliberately NOT lazied — they must render instantly on
 * tab switch, so AppNavigator keeps importing them statically.
 */

function LazyScreenFallback(): React.ReactElement {
  const colors = useThemeColors();
  return (
    <View style={[styles.fallback, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.brandPink} />
    </View>
  );
}

// React Navigation passes route props (navigation, route) into the screen
// component; forward them through the Suspense wrapper untouched. The generic
// is the screen's own component type `T`, and we return `T` — so the wrapped
// component is a drop-in for `Stack.Screen`'s `component=` prop and keeps each
// screen's exact route-prop typing (no widening that would trip
// `ScreenComponentType`'s structural check).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyScreen<T extends React.ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): T {
  const Lazy = React.lazy(loader);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function LazyScreen(props: any): React.ReactElement {
    return (
      <Suspense fallback={<LazyScreenFallback />}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  return LazyScreen as unknown as T;
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
