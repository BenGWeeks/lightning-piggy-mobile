// CRITICAL: Polyfills must be imported FIRST, before any other imports
import './src/polyfills';

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { WalletProvider } from './src/contexts/WalletContext';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <WalletProvider>
      <StatusBar style="light" />
      <AppNavigator />
    </WalletProvider>
  );
}
