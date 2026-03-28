import React from 'react';
import { Image, StyleSheet, ActivityIndicator, View, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';

import IntroScreen from '../screens/IntroScreen';
import HomeScreen from '../screens/HomeScreen';
import EarnScreen from '../screens/EarnScreen';
import LearnScreen from '../screens/LearnScreen';
import CourseDetailScreen from '../screens/CourseDetailScreen';
import MissionDetailScreen from '../screens/MissionDetailScreen';
import AccountScreen from '../screens/AccountScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const LearnStack = createNativeStackNavigator();

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
        name="Settings"
        component={AccountScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <Image
              source={require('../../assets/images/Account.png')}
              style={[styles.tabIcon, focused && styles.tabIconActive]}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { isConnected, isLoading } = useWallet();

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.white} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isConnected ? (
          <>
            <Stack.Screen name="Intro" component={IntroScreen} />
            <Stack.Screen name="Setup" component={AccountScreen} />
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
