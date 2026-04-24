import React from 'react';
import { StyleSheet, ActivityIndicator, View, Platform, useWindowDimensions } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { Home, MessageCircle, GraduationCap, Users } from 'lucide-react-native';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import {
  RootStackParamList,
  LearnStackParamList,
  MainTabParamList,
  AccountDrawerParamList,
} from './types';

import IntroScreen from '../screens/IntroScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import HomeScreen from '../screens/HomeScreen';
import MessagesScreen from '../screens/MessagesScreen';
import LearnScreen from '../screens/LearnScreen';
import CourseDetailScreen from '../screens/CourseDetailScreen';
import MissionDetailScreen from '../screens/MissionDetailScreen';
import FriendsScreen from '../screens/FriendsScreen';
import ConversationScreen from '../screens/ConversationScreen';
import ProfileScreen from '../screens/account/ProfileScreen';
import WalletsScreen from '../screens/account/WalletsScreen';
import NostrScreen from '../screens/account/NostrScreen';
import OnChainScreen from '../screens/account/OnChainScreen';
import DisplayScreen from '../screens/account/DisplayScreen';
import AboutScreen from '../screens/account/AboutScreen';
import AccountDrawerContent from '../components/AccountDrawerContent';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const LearnStack = createNativeStackNavigator<LearnStackParamList>();
const AccountDrawer = createDrawerNavigator<AccountDrawerParamList>();

function LearnStackNavigator() {
  return (
    <LearnStack.Navigator screenOptions={{ headerShown: false }}>
      <LearnStack.Screen name="LearnHome" component={LearnScreen} />
      <LearnStack.Screen name="CourseDetail" component={CourseDetailScreen} />
      <LearnStack.Screen name="MissionDetail" component={MissionDetailScreen} />
    </LearnStack.Navigator>
  );
}

function HomeTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        freezeOnBlur: true,
        tabBarStyle: {
          backgroundColor: colors.white,
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
      />
      <Tab.Screen
        name="Learn"
        component={LearnStackNavigator}
        options={{
          tabBarButtonTestID: 'tab-learn',
          tabBarAccessibilityLabel: 'Learn tab',
          tabBarIcon: ({ focused, color, size }) => (
            <GraduationCap size={size} color={color} strokeWidth={focused ? 2.5 : 2} />
          ),
        }}
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
        drawerStyle: { width: drawerWidth, backgroundColor: colors.white },
        swipeEdgeWidth: 32,
      }}
    >
      <AccountDrawer.Screen name="MainTabs" component={HomeTabs} />
      <AccountDrawer.Screen name="AccountProfile" component={ProfileScreen} />
      <AccountDrawer.Screen name="AccountWallets" component={WalletsScreen} />
      <AccountDrawer.Screen name="AccountNostr" component={NostrScreen} />
      <AccountDrawer.Screen name="AccountOnChain" component={OnChainScreen} />
      <AccountDrawer.Screen name="AccountDisplay" component={DisplayScreen} />
      <AccountDrawer.Screen name="AccountAbout" component={AboutScreen} />
    </AccountDrawer.Navigator>
  );
}

export default function AppNavigator() {
  const { isOnboarded, isLoading } = useWallet();

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.white} />
      </View>
    );
  }

  return (
    <NavigationContainer
      theme={{
        dark: false,
        colors: {
          primary: colors.brandPink,
          background: colors.brandPink,
          card: colors.white,
          text: colors.textHeader,
          border: colors.divider,
          notification: colors.brandPink,
        },
        fonts: {
          regular: { fontFamily: 'System', fontWeight: '400' },
          medium: { fontFamily: 'System', fontWeight: '500' },
          bold: { fontFamily: 'System', fontWeight: '700' },
          heavy: { fontFamily: 'System', fontWeight: '900' },
        },
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isOnboarded ? (
          <>
            <Stack.Screen name="Intro" component={IntroScreen} />
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Main" component={MainDrawer} />
            <Stack.Screen name="Conversation" component={ConversationScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.brandPink,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
