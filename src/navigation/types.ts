import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { NavigatorScreenParams } from '@react-navigation/native';

// Main tab param list
export type MainTabParamList = {
  Home:
    | { sendToAddress?: string; sendToName?: string; sendToPicture?: string; sendToPubkey?: string }
    | undefined;
  Earn: undefined;
  Learn: undefined;
  Friends: undefined;
  Account: undefined;
};

// Root stack (pre-auth and post-auth)
export type RootStackParamList = {
  Intro: undefined;
  Onboarding: undefined;
  Setup: undefined;
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  Conversation: {
    pubkey: string;
    name: string;
    picture?: string | null;
    lightningAddress?: string | null;
  };
  Groups: undefined;
  GroupConversation: { groupId: string };
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

// Route prop shortcuts
export type CourseDetailRoute = RouteProp<LearnStackParamList, 'CourseDetail'>;
export type MissionDetailRoute = RouteProp<LearnStackParamList, 'MissionDetail'>;
export type HomeRoute = RouteProp<MainTabParamList, 'Home'>;
export type GroupConversationRoute = RouteProp<RootStackParamList, 'GroupConversation'>;
