import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';

// Root stack (pre-auth and post-auth)
export type RootStackParamList = {
  Intro: undefined;
  Onboarding: undefined;
  Setup: undefined;
  MainTabs: undefined;
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
