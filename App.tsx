// CRITICAL: Polyfills must be imported FIRST, before any other imports
import './src/polyfills';

import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import Toast, { BaseToast, ErrorToast, InfoToast } from 'react-native-toast-message';
import { WalletProvider, useWallet } from './src/contexts/WalletContext';
import { NostrProvider } from './src/contexts/NostrContext';
import AppNavigator from './src/navigation/AppNavigator';
import PaymentProgressOverlay from './src/components/PaymentProgressOverlay';
import BootSplash from './src/components/BootSplash';

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
  // Boot splash — keeps the pig on screen from JS-mount for a minimum
  // 600 ms so the user never sees the plain-pink native-splash-to-JS
  // handoff. 600 ms is well under the observed cold-launch time on
  // Pixel/cellular (55+ s) but long enough that the splash doesn't
  // feel like a flash. Home renders behind the splash during this
  // window; when we fade the splash out, Home is usually ready.
  const [bootDone, setBootDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setBootDone(true), 600);
    return () => clearTimeout(t);
  }, []);

  return (
    <GestureHandlerRootView style={styles.container}>
      {/* KeyboardProvider drives react-native-keyboard-controller. On
          Android 15 edge-to-edge the classic RN Keyboard event API is
          unreliable (issue #194); RNKC subscribes to the platform
          IME inset via WindowInsetsCompat and exposes it to hooks
          like useReanimatedKeyboardAnimation that the composer uses. */}
      <KeyboardProvider>
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
        <BootSplash done={bootDone} />
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
