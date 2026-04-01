import React from 'react';
import { Image, StyleSheet, ActivityIndicator, View, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { RootStackParamList, LearnStackParamList, MainTabParamList } from './types';

import IntroScreen from '../screens/IntroScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import HomeScreen from '../screens/HomeScreen';
import EarnScreen from '../screens/EarnScreen';
import LearnScreen from '../screens/LearnScreen';
import CourseDetailScreen from '../screens/CourseDetailScreen';
import MissionDetailScreen from '../screens/MissionDetailScreen';
import AccountScreen from '../screens/AccountScreen';
import FriendsScreen from '../screens/FriendsScreen';
import FriendsIcon from '../components/icons/FriendsIcon';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const LearnStack = createNativeStackNavigator<LearnStackParamList>();

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
          tabBarIcon: ({ focused }) => (
            <Image
              source={require('../../assets/images/Home.png')}
              style={[styles.tabIcon, focused && styles.tabIconActive]}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Earn"
        component={EarnScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <Image
              source={require('../../assets/images/Earn.png')}
              style={[styles.tabIcon, focused && styles.tabIconActive]}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Learn"
        component={LearnStackNavigator}
        options={{
          tabBarIcon: ({ focused }) => (
            <Image
              source={require('../../assets/images/Learn.png')}
              style={[styles.tabIcon, focused && styles.tabIconActive]}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Friends"
        component={FriendsScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <FriendsIcon size={22} color={focused ? colors.brandPink : colors.textSupplementary} />
          ),
        }}
      />
      <Tab.Screen
        name="Account"
        component={AccountScreen}
        options={{
          tabBarButton: () => null,
          tabBarItemStyle: { display: 'none' },
        }}
      />
    </Tab.Navigator>
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
          <Stack.Screen name="MainTabs" component={HomeTabs} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabIcon: {
    width: 22,
    height: 22,
    resizeMode: 'contain' as const,
    tintColor: colors.textSupplementary,
  },
  tabIconActive: {
    tintColor: colors.brandPink,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.brandPink,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
