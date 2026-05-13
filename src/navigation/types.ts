import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { RouteProp } from '@react-navigation/native';
import { NavigatorScreenParams } from '@react-navigation/native';
import type { ContactProfileBodyData } from '../components/ContactProfileBody';

// Main tab param list
export type MainTabParamList = {
  Home:
    | { sendToAddress?: string; sendToName?: string; sendToPicture?: string; sendToPubkey?: string }
    | undefined;
  Messages: undefined;
  // Explore hosts a sub-stack so the type carries NavigatorScreenParams
  // — that's what lets the Linking listener (App.tsx → navigateToHuntFound
  // in AppNavigator.tsx) target a specific Explore-stack screen like
  // HuntFound from outside the React tree.
  Explore: NavigatorScreenParams<ExploreStackParamList> | undefined;
  Friends: undefined;
};

// Drawer wrapping the main tabs + per-section account screens. MainTabs
// is the initial drawer route, so on launch the user sees the tabs and
// can open the drawer with the top-right avatar (or edge-swipe).
export type AccountDrawerParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  AccountProfile: undefined;
  AccountWallets: undefined;
  AccountNostr: undefined;
  AccountOnChain: undefined;
  AccountDisplay: undefined;
  AccountAppearance: undefined;
  AccountNearby: undefined;
  AccountSecurity: undefined;
  AccountAbout: undefined;
};

// Root stack
export type RootStackParamList = {
  Main: NavigatorScreenParams<AccountDrawerParamList>;
  Conversation: {
    pubkey: string;
    name: string;
    picture?: string | null;
    lightningAddress?: string | null;
  };
  Groups: undefined;
  GroupConversation: { groupId: string };
  // Full-page friends profile (#435). `phoneContactId` is set when the
  // contact came from the device address book and can be edited inline.
  ContactProfile: {
    contact: ContactProfileBodyData;
    phoneContactId?: string;
  };
};

// Explore sub-stack — the renamed Learn tab now hosts a hub plus Lessons
// (existing course content), Map (BTC Map merchants), Hunt (geocaching
// game), and Events (NIP-52 meetups). MainTabParamList above references
// this via NavigatorScreenParams<ExploreStackParamList>; the lexical
// definition order is reversed (forward reference at type level), which
// TypeScript resolves fine — keep the order as-is.
// See plan .claude/plans/look-through-the-issues-squishy-wigderson.md
// for motivation; closes parts of #467 and #468.
export type ExploreStackParamList = {
  ExploreHome: undefined;
  Lessons: undefined;
  CourseDetail: { courseId: string };
  MissionDetail: { courseId: string; missionId: string };
  Map: undefined;
  Places: undefined;
  PlaceDetail: { placeId: number };
  Hunt: undefined;
  HuntCreate: undefined;
  HuntFound: { lnurl: string };
  HuntPiggyDetail: { coord: string };
  MyPiglets: undefined;
  Events: undefined;
  EventDetail: { coord: string };
};

// Navigation prop shortcuts
export type RootNavigation = NativeStackNavigationProp<RootStackParamList>;
export type ExploreNavigation = NativeStackNavigationProp<ExploreStackParamList>;
export type AccountDrawerNavigation = DrawerNavigationProp<AccountDrawerParamList>;

// Route prop shortcuts
export type CourseDetailRoute = RouteProp<ExploreStackParamList, 'CourseDetail'>;
export type MissionDetailRoute = RouteProp<ExploreStackParamList, 'MissionDetail'>;
export type HomeRoute = RouteProp<MainTabParamList, 'Home'>;
export type GroupConversationRoute = RouteProp<RootStackParamList, 'GroupConversation'>;
