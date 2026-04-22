// CRITICAL: Polyfills must be imported FIRST, before any other imports
import './src/polyfills';

import React from 'react';
import { StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import Toast, { BaseToast, ErrorToast, InfoToast } from 'react-native-toast-message';
import { WalletProvider, useWallet } from './src/contexts/WalletContext';
import { NostrProvider } from './src/contexts/NostrContext';
import AppNavigator from './src/navigation/AppNavigator';
import PaymentProgressOverlay from './src/components/PaymentProgressOverlay';

// Render toasts with unlimited-line body so long error messages (e.g. Electrum
// script-verify errors) aren't truncated. Height grows to fit content.
const toastConfig = {
  success: (props: React.ComponentProps<typeof BaseToast>) => (
    <BaseToast
      {...props}
      text1NumberOfLines={2}
      text2NumberOfLines={0}
      style={[props.style, { height: undefined, minHeight: 60, paddingVertical: 10 }]}
      text2Style={{ fontSize: 13, flexWrap: 'wrap' }}
    />
  ),
  info: (props: React.ComponentProps<typeof InfoToast>) => (
    <InfoToast
      {...props}
      text1NumberOfLines={2}
      text2NumberOfLines={0}
      style={[props.style, { height: undefined, minHeight: 60, paddingVertical: 10 }]}
      text2Style={{ fontSize: 13, flexWrap: 'wrap' }}
    />
  ),
  error: (props: React.ComponentProps<typeof ErrorToast>) => (
    <ErrorToast
      {...props}
      text1NumberOfLines={2}
      text2NumberOfLines={0}
      style={[props.style, { height: undefined, minHeight: 60, paddingVertical: 10 }]}
      text2Style={{ fontSize: 13, flexWrap: 'wrap' }}
    />
  ),
};

// Renders the global incoming-payment celebration on top of the nav
// stack. Lives inside the WalletProvider so it can subscribe to the
// context's incoming-payment event bus, and above any screen so the
// confetti pops no matter where the user is when a payment lands.
function GlobalIncomingPaymentOverlay() {
  const { lastIncomingPayment, clearLastIncomingPayment } = useWallet();
  // Key on the event timestamp so a second payment arriving while the
  // overlay is still visible remounts the component and re-arms the
  // confetti animation. Without this, a second `success` in a row
  // wouldn't retrigger the burst (state stays 'success', no transition).
  return (
    <PaymentProgressOverlay
      key={lastIncomingPayment?.at ?? 'idle'}
      state={lastIncomingPayment ? 'success' : 'hidden'}
      direction="receive"
      amountSats={lastIncomingPayment?.amountSats}
      onDismiss={clearLastIncomingPayment}
    />
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <WalletProvider>
        <NostrProvider>
          <BottomSheetModalProvider>
            <StatusBar style="light" />
            <AppNavigator />
          </BottomSheetModalProvider>
          <Toast topOffset={60} config={toastConfig} />
          <GlobalIncomingPaymentOverlay />
        </NostrProvider>
      </WalletProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
