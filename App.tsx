// CRITICAL: Polyfills must be imported FIRST, before any other imports
import './src/polyfills';

import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { WalletProvider, useWallet } from './src/contexts/WalletContext';
import { NostrProvider } from './src/contexts/NostrContext';
import { GroupsProvider } from './src/contexts/GroupsContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import AppNavigator from './src/navigation/AppNavigator';
import PaymentProgressOverlay from './src/components/PaymentProgressOverlay';
import BootSplash from './src/components/BootSplash';
import { BrandedAlertHost } from './src/components/BrandedAlert';
import { BrandedToast } from './src/components/BrandedToast';

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

// Symmetric outgoing-payment overlay. Reads `sendProgress` from the
// WalletContext so any future entry-point (Friends quick-zap, deep
// link, share extension, ...) can drive the same global progress UI
// without re-implementing the bubbles/spinner JSX in every caller.
// The originating sheet hands its `onCancel` (abort the in-flight NWC
// call) and `onDismiss` (close the sheet on success) callbacks in via
// `reportSendStart`; this component just routes Cancel and OK taps to
// them and clears the slot afterwards.
function GlobalSendOverlay() {
  const { sendProgress, clearSendProgress } = useWallet();
  // Only fire `onDismiss` on the success path — on error the originating
  // sheet stays open so the user can retry from the filled-in form. This
  // is the bit that used to live in `SendSheet.handleOverlayDismiss` as
  // `if (wasSuccess) onClose()`. Reading `state` straight off the live
  // `sendProgress` here means we never need a ref-based stale-closure
  // dance — there's only one callsite, and it reads the latest value.
  const handleDismiss = () => {
    const wasSuccess = sendProgress?.state === 'success';
    const cb = sendProgress?.onDismiss;
    clearSendProgress();
    if (wasSuccess) cb?.();
  };
  const handleCancel = () => {
    sendProgress?.onCancel?.();
    clearSendProgress();
  };
  return (
    <PaymentProgressOverlay
      key={sendProgress?.at ?? 'idle'}
      state={sendProgress?.state ?? 'hidden'}
      direction="send"
      amountSats={sendProgress?.amountSats}
      recipientName={sendProgress?.recipientName}
      errorMessage={sendProgress?.errorMessage}
      onDismiss={handleDismiss}
      onCancel={sendProgress?.onCancel ? handleCancel : undefined}
    />
  );
}

// StatusBar needs to live inside ThemeProvider so its style flips with the
// active scheme; splitting it out keeps the provider tree readable.
function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
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
      {/* SafeAreaProvider feeds `useSafeAreaInsets()` — without it all
          insets silently return 0 and the composer's safe-area padding
          (above the gesture bar) collapses. Needed company to the
          react-native-edge-to-edge plugin so insets propagate end-to-end. */}
      <SafeAreaProvider>
        {/* KeyboardProvider drives react-native-keyboard-controller.
            Paired with react-native-edge-to-edge (plugin in app.config.ts)
            it subscribes to `WindowInsetsCompat.Type.ime()` and exposes
            the IME inset to hooks + components like KeyboardStickyView.
            Without edge-to-edge, Android 15+ silently reports 0 keyboard
            height to every API (see #194 diagnosis). */}
        <KeyboardProvider>
          <ThemeProvider>
            <WalletProvider>
              <NostrProvider>
                {/* GroupsProvider sits inside Nostr so groups can subscribe
                    to multi-recipient gift wraps using the active signer. */}
                <GroupsProvider>
                  <BottomSheetModalProvider>
                    <ThemedStatusBar />
                    <AppNavigator />
                  </BottomSheetModalProvider>
                  {/* BrandedToast: brand-themed wrapper around
                      `react-native-toast-message`. Single mount for the
                      app's toast slot — keeps styling (pink success
                      accent, red error, rounded corners + shadow that
                      mirror BrandedAlert) in one place. ESLint blocks
                      direct imports of the underlying lib elsewhere. */}
                  <BrandedToast />
                  <GlobalIncomingPaymentOverlay />
                  <GlobalSendOverlay />
                  {/* BrandedAlertHost: portal target for the on-brand
                      BrandedAlert dialog. Sits at the root so any sheet /
                      screen that calls `Alert.alert(...)` (the BrandedAlert
                      drop-in re-export, NOT the system Alert) renders
                      above the rest of the UI without z-index gymnastics. */}
                  <BrandedAlertHost />
                </GroupsProvider>
              </NostrProvider>
            </WalletProvider>
            <BootSplash done={bootDone} />
          </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
