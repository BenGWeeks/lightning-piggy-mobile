import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { RouteProp } from '@react-navigation/native';
import { NavigatorScreenParams } from '@react-navigation/native';

// Main tab param list
export type MainTabParamList = {
  Home:
    | { sendToAddress?: string; sendToName?: string; sendToPicture?: string; sendToPubkey?: string }
    | undefined;
  Messages: undefined;
  Explore: undefined;
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
};

// Explore sub-stack — the renamed Learn tab now hosts a hub plus Lessons
// (existing course content), Map (BTC Map merchants), Hunt (geocaching
// game), and Events (NIP-52 meetups). See plan
// .claude/plans/look-through-the-issues-squishy-wigderson.md for the
// motivation; closes parts of #467 and #468.
export type ExploreStackParamList = {
  ExploreHome: undefined;
  Lessons: undefined;
  CourseDetail: { courseId: string };
  MissionDetail: { courseId: string; missionId: string };
  Map: undefined;
  Hunt: undefined;
  Events: undefined;
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
