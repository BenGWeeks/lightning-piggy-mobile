import React, { useEffect, useMemo, useState } from 'react';
import {
  Linking,
  StyleSheet,
  ActivityIndicator,
  View,
  Platform,
  useWindowDimensions,
} from 'react-native';
import {
  NavigationContainer,
  NavigationState,
  StackActions,
  createNavigationContainerRef,
} from '@react-navigation/native';
import {
  loadPersistedNavigationState,
  persistNavigationState,
} from '../utils/navigationStatePersistence';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { Home, MessageCircle, Compass, Users } from 'lucide-react-native';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { setActiveThread, setActiveCache } from '../services/notificationService';
import {
  RootStackParamList,
  ExploreStackParamList,
  MainTabParamList,
  AccountDrawerParamList,
} from './types';
import type { ContactProfileBodyData } from '../components/ContactProfileBody';

import HomeScreen from '../screens/HomeScreen';
import MessagesScreen from '../screens/MessagesScreen';
import ExploreHomeScreen from '../screens/ExploreHomeScreen';
import LessonsScreen from '../screens/LessonsScreen';
import MapScreen from '../screens/MapScreen';
import PlacesScreen from '../screens/PlacesScreen';
import PlaceDetailScreen from '../screens/PlaceDetailScreen';
import HuntScreen from '../screens/HuntScreen';
import HuntCreateScreen from '../screens/HuntCreateScreen';
import HuntFoundScreen from '../screens/HuntFoundScreen';
import HuntPiggyDetailScreen from '../screens/HuntPiggyDetailScreen';
import MyPigletsScreen from '../screens/MyPigletsScreen';
import EventsScreen from '../screens/EventsScreen';
import EventDetailScreen from '../screens/EventDetailScreen';
import CourseDetailScreen from '../screens/CourseDetailScreen';
import MissionDetailScreen from '../screens/MissionDetailScreen';
import FriendsScreen from '../screens/FriendsScreen';
import ConversationScreen from '../screens/ConversationScreen';
import GroupsScreen from '../screens/GroupsScreen';
import GroupConversationScreen from '../screens/GroupConversationScreen';
import ContactProfileScreen from '../screens/ContactProfileScreen';
import UnsupportedEntityScreen from '../screens/UnsupportedEntityScreen';
import ProfileScreen from '../screens/account/ProfileScreen';
import WalletsScreen from '../screens/account/WalletsScreen';
import NostrScreen from '../screens/account/NostrScreen';
import OnChainScreen from '../screens/account/OnChainScreen';
import DisplayScreen from '../screens/account/DisplayScreen';
import AppearanceScreen from '../screens/account/AppearanceScreen';
import NearbyScreen from '../screens/account/NearbyScreen';
import SecurityScreen from '../screens/account/SecurityScreen';
import AboutScreen from '../screens/account/AboutScreen';
import AccountDrawerContent from '../components/AccountDrawerContent';
import { perfLog, perfTabTap, perfTabRendered, perfTabHidden } from '../utils/perfLog';

let __appNavigatorFirstRenderLogged = false;

/**
 * Imperative navigation ref consumed by `App.tsx`'s Linking listener so
 * incoming `lightning:LNURL…` URIs (NFC tag tap, deep link from another
 * app) can route to HuntFoundScreen without React-Navigation's static
 * `linking` config — which doesn't fit a non-path-segmented URI scheme
 * cleanly. Use `navigateToHuntFound(lnurl)` from outside the React tree.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export const navigateToHuntFound = (lnurl: string): boolean => {
  if (!navigationRef.isReady()) return false;
  navigationRef.navigate('Main', {
    screen: 'MainTabs',
    params: {
      screen: 'Explore',
      params: { screen: 'HuntFound', params: { lnurl } },
    },
  });
  return true;
};

// Navigate to a specific Piggy listing by coord (`kind:pubkey:d`).
// Entry-points: the App.tsx Linking listener for
// `lightningpiggy://hunt/<coord>` AND `nostr:naddr1...` deep links
// emitted by the multi-record NFC tags (#73).
export const navigateToHuntPiggyDetail = (coord: string): boolean => {
  if (!navigationRef.isReady()) return false;
  // Set the Explore stack state explicitly so back from HuntPiggyDetail
  // walks through Hunt (Geo-caches list) → ExploreHome, matching the
  // user's mental model. Pre-fix the nested `navigate(..., { screen:
  // 'HuntPiggyDetail' })` shortcut left the Explore stack with only
  // HuntPiggyDetail at index 0 — back-press exited Explore to the
  // previous tab (usually Home), and Explore-tab-tap was a no-op
  // because there was nothing to pop. Bug spotted on Pixel: "back
  // goes to home — not to Geo-caches".
  navigationRef.navigate('Main', {
    screen: 'MainTabs',
    params: {
      screen: 'Explore',
      params: {
        state: {
          index: 2,
          routes: [
            { name: 'ExploreHome' },
            { name: 'Hunt' },
            { name: 'HuntPiggyDetail', params: { coord } },
          ],
        },
      },
    },
  });
  return true;
};

// Open a contact's full-page profile from outside the React tree —
// the App.tsx deep-link / NFC handler for `nostr:npub…` / `nostr:nprofile…`
// (#754). `contact` is a ready-built ContactProfileBodyData; when the
// kind-0 fetch hasn't resolved yet the caller passes a pubkey-only stub
// and the screen fills in the bio + Lightning address itself. Returns
// false until the nav tree is ready so a cold-start tap can retry.
export const navigateToContactProfile = (contact: ContactProfileBodyData): boolean => {
  if (!navigationRef.isReady()) return false;
  navigationRef.navigate('ContactProfile', { contact });
  return true;
};

// Graceful fallback for a scanned tag / nostr: link whose entity type
// has no in-app screen (e.g. a kind-1 note, or a `nostr:` URI we can't
// decode). Mirrors the Hunt deep-link retry contract — returns false
// until the nav tree mounts. Used by the App.tsx nostr: router (#754).
export const navigateToUnsupportedEntity = (entity: string, detail?: string): boolean => {
  if (!navigationRef.isReady()) return false;
  navigationRef.navigate('UnsupportedEntity', { entity, detail });
  return true;
};

/**
 * Route from a tapped OS notification (#279). Reads the `data` payload the
 * notificationService attached and opens the relevant surface:
 *  - dm            → the 1:1 Conversation thread
 *  - group         → the GroupConversation thread
 *  - payment / zap → the Home (wallet) tab
 *
 * Called from the notification-response listener in App.tsx. Returns false
 * if the nav tree isn't ready yet (caller retries on cold start).
 */
export const navigateFromNotification = (data: {
  kind?: string;
  conversationPubkey?: string;
  groupId?: string;
  walletId?: string;
  cacheCoord?: string;
}): boolean => {
  if (!navigationRef.isReady()) return false;
  if (data.conversationPubkey) {
    // `name` is required by the route type but the screen fills the real
    // header from its own profile fetch, so seed it empty.
    navigationRef.navigate('Conversation', { pubkey: data.conversationPubkey, name: '' });
    return true;
  }
  if (data.groupId) {
    navigationRef.navigate('GroupConversation', { groupId: data.groupId });
    return true;
  }
  // Find-log on one of my caches (#740) → open that cache detail. The
  // background detect-and-ping path passes the sentinel `__background__`
  // coord (it didn't resolve to a specific cache) — fall through to the
  // Geo-caches list in that case instead of pushing a doomed detail.
  if (data.kind === 'cache') {
    if (data.cacheCoord && data.cacheCoord !== '__background__') {
      return navigateToHuntPiggyDetail(data.cacheCoord);
    }
    navigationRef.navigate('Main', {
      screen: 'MainTabs',
      params: { screen: 'Explore', params: { screen: 'Hunt' } },
    });
    return true;
  }
  // Generic message ping with no thread id (the background detect-and-ping
  // path, which doesn't decrypt) → open the Messages list.
  if (data.kind === 'dm' || data.kind === 'group') {
    navigationRef.navigate('Main', { screen: 'MainTabs', params: { screen: 'Messages' } });
    return true;
  }
  // payment / zap (or anything else) → wallet home.
  navigationRef.navigate('Main', { screen: 'MainTabs', params: { screen: 'Home' } });
  return true;
};

/**
 * Keep notificationService's "active thread" in sync with the focused route
 * (#279), so DM / group notifications are suppressed for the thread the user
 * is currently viewing. Done centrally here (off the back of the existing
 * onStateChange) rather than per-screen, to avoid growing the over-cap
 * Conversation / GroupConversation screen files (#703).
 */
function syncActiveThreadFromNav(): void {
  const route = navigationRef.getCurrentRoute();
  if (route?.name === 'Conversation') {
    setActiveThread((route.params as { pubkey?: string } | undefined)?.pubkey ?? null);
  } else if (route?.name === 'GroupConversation') {
    setActiveThread((route.params as { groupId?: string } | undefined)?.groupId ?? null);
  } else {
    setActiveThread(null);
  }
  // Active-cache suppression (#740) — if the focused screen is the
  // detail view for a specific cache, find-logs against that coord stay
  // silent. Independent of the thread gate so a DM and a cache can't
  // collide on the same identifier.
  if (route?.name === 'HuntPiggyDetail') {
    setActiveCache((route.params as { coord?: string } | undefined)?.coord ?? null);
  } else {
    setActiveCache(null);
  }
}

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const ExploreStack = createNativeStackNavigator<ExploreStackParamList>();
const AccountDrawer = createDrawerNavigator<AccountDrawerParamList>();

function ExploreStackNavigator() {
  return (
    <ExploreStack.Navigator screenOptions={{ headerShown: false }}>
      <ExploreStack.Screen name="ExploreHome" component={ExploreHomeScreen} />
      <ExploreStack.Screen name="Lessons" component={LessonsScreen} />
      <ExploreStack.Screen name="CourseDetail" component={CourseDetailScreen} />
      <ExploreStack.Screen name="MissionDetail" component={MissionDetailScreen} />
      <ExploreStack.Screen name="Map" component={MapScreen} />
      <ExploreStack.Screen name="Places" component={PlacesScreen} />
      <ExploreStack.Screen name="PlaceDetail" component={PlaceDetailScreen} />
      <ExploreStack.Screen name="Hunt" component={HuntScreen} />
      <ExploreStack.Screen name="HuntCreate" component={HuntCreateScreen} />
      <ExploreStack.Screen name="HuntFound" component={HuntFoundScreen} />
      <ExploreStack.Screen name="HuntPiggyDetail" component={HuntPiggyDetailScreen} />
      <ExploreStack.Screen name="MyPiglets" component={MyPigletsScreen} />
      <ExploreStack.Screen name="Events" component={EventsScreen} />
      <ExploreStack.Screen name="EventDetail" component={EventDetailScreen} />
    </ExploreStack.Navigator>
  );
}

function HomeTabs() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        // Lazy-mount tabs so cold-start only pays for the focused one.
        // Without this, react-navigation v7 mounts every Tab.Screen at
        // boot — and the Explore stack alone fires a ~3 MB BTC Map
        // fetch, two Nostr relay subscriptions, and a foreground
        // location request before the user has ever tapped Explore.
        // Combined with `freezeOnBlur: true` below, screens still hold
        // their state across tab switches once they've been visited.
        lazy: true,
        freezeOnBlur: true,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
          height: Platform.OS === 'android' ? 80 : 70,
          paddingBottom: Platform.OS === 'android' ? 20 : 10,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.brandPink,
        tabBarInactiveTintColor: colors.textSupplementary,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarButtonTestID: 'tab-home',
          tabBarAccessibilityLabel: 'Home tab',
          tabBarIcon: ({ focused, color, size }) => (
            <Home size={size} color={color} strokeWidth={focused ? 2.5 : 2} />
          ),
        }}
        listeners={{
          tabPress: () => perfTabTap('Home'),
          focus: () => perfTabRendered('Home'),
          blur: () => perfTabHidden('Home'),
        }}
      />
      <Tab.Screen
        name="Messages"
        component={MessagesScreen}
        options={{
          tabBarButtonTestID: 'tab-messages',
          tabBarAccessibilityLabel: 'Messages tab',
          tabBarIcon: ({ focused, color, size }) => (
            <MessageCircle size={size} color={color} strokeWidth={focused ? 2.5 : 2} />
          ),
        }}
        listeners={{
          tabPress: () => perfTabTap('Messages'),
          focus: () => perfTabRendered('Messages'),
          blur: () => perfTabHidden('Messages'),
        }}
      />
      <Tab.Screen
        name="Explore"
        component={ExploreStackNavigator}
        options={{
          tabBarButtonTestID: 'tab-explore',
          tabBarAccessibilityLabel: 'Explore tab',
          tabBarIcon: ({ focused, color, size }) => (
            <Compass size={size} color={color} strokeWidth={focused ? 2.5 : 2} />
          ),
        }}
        listeners={({ navigation }) => ({
          // Pop the Explore sub-stack back to its root every time the
          // tab is tapped — whether Explore is already focused (a
          // double-tap on the active tab) OR being switched into from
          // another tab. Pre-fix this only fired when already focused,
          // so an NFC-tap deep-link or wizard navigation that left
          // HuntPiggyDetail / HuntCreate on the stack would resume on
          // that screen the next time the user hit the Explore tab
          // from elsewhere — even though their mental model is "tap
          // the tab to go to Explore".
          //
          // The earlier version used navigation.navigate('Explore',
          // { screen: 'ExploreHome' }) which RN treats as a no-op when
          // Explore is already focused. Dispatching StackActions.popToTop
          // hits the inner Explore stack navigator directly and pops
          // every screen above ExploreHome regardless of current focus.
          tabPress: (e) => {
            perfTabTap('Explore');
            const state = navigation.getState();
            const tabRoute = state?.routes.find((r) => r.name === 'Explore');
            const subState = tabRoute?.state;
            const exploreIsFocused = state.routes[state.index]?.name === 'Explore';
            // Gated on __DEV__ so the diagnostic doesn't leak into
            // perf-instrumented release builds — EXPO_PUBLIC_KEEP_PERF_LOGS
            // disables babel's transform-remove-console plugin, which
            // would otherwise strip these (Copilot #578 r1 catch).
            if (__DEV__) {
              console.log(
                `[Tab:Explore] tabPress focused=${exploreIsFocused} subIdx=${subState?.index} subKey=${subState?.key} routes=[${(subState?.routes ?? []).map((r) => r.name).join(',')}]`,
              );
            }
            if (subState && typeof subState.index === 'number' && subState.index > 0) {
              if (exploreIsFocused) e.preventDefault();
              if (__DEV__) {
                console.log(`[Tab:Explore] dispatching popToTop target=${subState.key}`);
              }
              navigation.dispatch({
                ...StackActions.popToTop(),
                target: subState.key,
              });
            }
          },
          focus: () => perfTabRendered('Explore'),
          blur: () => perfTabHidden('Explore'),
        })}
      />
      <Tab.Screen
        name="Friends"
        component={FriendsScreen}
        options={{
          tabBarButtonTestID: 'tab-friends',
          tabBarAccessibilityLabel: 'Friends tab',
          tabBarIcon: ({ focused, color, size }) => (
            <Users size={size} color={color} strokeWidth={focused ? 2.5 : 2} />
          ),
        }}
        listeners={{
          tabPress: () => perfTabTap('Friends'),
          focus: () => perfTabRendered('Friends'),
          blur: () => perfTabHidden('Friends'),
        }}
      />
    </Tab.Navigator>
  );
}

/**
 * Drawer wrapping the main tabs + per-section account screens. Tapping
 * the avatar in the tab header opens the drawer; tapping a row closes
 * the drawer and navigates to the matching section screen. See issue
 * #100 for the Primal/Damus-style spec.
 */
function MainDrawer() {
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  // Drawer width sized to fit the menu comfortably (not a fixed 50%).
  // Capped so it still looks like a drawer on tablets.
  const drawerWidth = Math.min(Math.max(280, width * 0.65), 360);

  return (
    <AccountDrawer.Navigator
      initialRouteName="MainTabs"
      drawerContent={(props) => <AccountDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        drawerPosition: 'right',
        drawerStyle: { width: drawerWidth, backgroundColor: colors.surface },
        swipeEdgeWidth: 32,
      }}
    >
      <AccountDrawer.Screen name="MainTabs" component={HomeTabs} />
      <AccountDrawer.Screen name="AccountProfile" component={ProfileScreen} />
      <AccountDrawer.Screen name="AccountWallets" component={WalletsScreen} />
      <AccountDrawer.Screen name="AccountNostr" component={NostrScreen} />
      <AccountDrawer.Screen name="AccountOnChain" component={OnChainScreen} />
      <AccountDrawer.Screen name="AccountDisplay" component={DisplayScreen} />
      <AccountDrawer.Screen name="AccountAppearance" component={AppearanceScreen} />
      <AccountDrawer.Screen name="AccountNearby" component={NearbyScreen} />
      <AccountDrawer.Screen name="AccountSecurity" component={SecurityScreen} />
      <AccountDrawer.Screen name="AccountAbout" component={AboutScreen} />
    </AccountDrawer.Navigator>
  );
}

export default function AppNavigator() {
  if (!__appNavigatorFirstRenderLogged) {
    __appNavigatorFirstRenderLogged = true;
    perfLog('AppNavigator first render');
  }
  const { isLoading } = useWallet();
  const { scheme, colors } = useTheme();

  // Persist + restore navigation state across cold-starts so the user
  // lands back on the tab / screen they left (#598). The OS killing
  // the backgrounded process — common on GrapheneOS, also stock Android
  // under memory pressure — would otherwise drop them on Home every
  // time. A pending deep-link short-circuits the restore: the existing
  // Linking handler in App.tsx routes the user where the URL says.
  const [isRestoringNavState, setIsRestoringNavState] = useState(true);
  const [initialNavState, setInitialNavState] = useState<NavigationState | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) return;
        const saved = await loadPersistedNavigationState();
        if (!cancelled && saved) setInitialNavState(saved);
      } catch {
        // Linking.getInitialURL() can reject on platforms where the
        // intent-resolution chain isn't ready yet (rare, but seen on
        // some Android OEMs). Treat it as "no deep-link, no saved
        // state" — the navigator renders its defaults and the user
        // lands on Home.
      } finally {
        if (!cancelled) setIsRestoringNavState(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const navTheme = useMemo(
    () => ({
      dark: scheme === 'dark',
      colors: {
        primary: colors.brandPink,
        background: colors.background,
        card: colors.surface,
        text: colors.textHeader,
        border: colors.divider,
        notification: colors.brandPink,
      },
      fonts: {
        regular: { fontFamily: 'System', fontWeight: '400' as const },
        medium: { fontFamily: 'System', fontWeight: '500' as const },
        bold: { fontFamily: 'System', fontWeight: '700' as const },
        heavy: { fontFamily: 'System', fontWeight: '900' as const },
      },
    }),
    [scheme, colors],
  );

  if (isLoading || isRestoringNavState) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.brandPink }]}>
        <ActivityIndicator size="large" color={colors.white} />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      initialState={initialNavState}
      onStateChange={(state) => {
        // Fire-and-forget — failures are swallowed inside the util so
        // a flaky AsyncStorage write can't crash navigation.
        void persistNavigationState(state);
        // Suppress notifications for the thread the user is now viewing.
        syncActiveThreadFromNav();
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={MainDrawer} />
        <Stack.Screen name="Conversation" component={ConversationScreen} />
        <Stack.Screen name="Groups" component={GroupsScreen} />
        <Stack.Screen name="GroupConversation" component={GroupConversationScreen} />
        <Stack.Screen name="ContactProfile" component={ContactProfileScreen} />
        <Stack.Screen name="UnsupportedEntity" component={UnsupportedEntityScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
