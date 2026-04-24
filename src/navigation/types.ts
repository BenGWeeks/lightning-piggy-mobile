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
  Learn: undefined;
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
};

// Learn sub-stack
export type LearnStackParamList = {
  LearnHome: undefined;
  CourseDetail: { courseId: string };
  MissionDetail: { courseId: string; missionId: string };
};

// Navigation prop shortcuts
export type RootNavigation = NativeStackNavigationProp<RootStackParamList>;
export type LearnNavigation = NativeStackNavigationProp<LearnStackParamList>;
export type AccountDrawerNavigation = DrawerNavigationProp<AccountDrawerParamList>;

// Route prop shortcuts
export type CourseDetailRoute = RouteProp<LearnStackParamList, 'CourseDetail'>;
export type MissionDetailRoute = RouteProp<LearnStackParamList, 'MissionDetail'>;
export type HomeRoute = RouteProp<MainTabParamList, 'Home'>;
