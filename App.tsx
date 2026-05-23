// CRITICAL: Polyfills must be imported FIRST, before any other imports
import './src/polyfills';

import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { WalletProvider, useWallet } from './src/contexts/WalletContext';
import { NostrProvider } from './src/contexts/NostrContext';
import { TrustGraphProvider } from './src/contexts/TrustGraphContext';
import { GroupsProvider } from './src/contexts/GroupsContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { UserLocationProvider } from './src/contexts/UserLocationContext';
import AppNavigator, {
  navigateToHuntFound,
  navigateToHuntPiggyDetail,
} from './src/navigation/AppNavigator';
import * as nip19 from 'nostr-tools/nip19';
import { wasRecentlyRead, initNfc } from './src/services/nfcService';
import PaymentProgressOverlay from './src/components/PaymentProgressOverlay';
import BootSplash from './src/components/BootSplash';
import { BrandedAlertHost } from './src/components/BrandedAlert';
import { BrandedToast, Toast } from './src/components/BrandedToast';
import OfflineBanner from './src/components/OfflineBanner';

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
      // Forwarded so the overlay can render an on-chain-specific
      // subtitle hint (mempool / unconfirmed) — see #134.
      receiveSource={lastIncomingPayment?.source}
      onDismiss={clearLastIncomingPayment}
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

  // Pre-warm NfcManager.start() at app mount so the first NfcReadSheet
  // / NfcWriteSheet open can call requestTechnology immediately
  // (reader-mode active within ms) instead of waiting on the native
  // bridge. Without this warm-up there's a ~150–300 ms window after
  // tapping "Try prize" where reader-mode hasn't activated yet — fast
  // hiders bring the tag to the phone in that window and the OS
  // dispatches a "Open with…" chooser instead of routing through our
  // in-app reader. Fire-and-forget; failure is non-fatal (each sheet
  // re-tries via `ensureNfcStarted` on its own).
  useEffect(() => {
    void initNfc();
  }, []);

  // `lightning:` deep-link listener (Hunt finder flow, #468). LP registers
  // the scheme in app.config.ts so an NFC tag tap or a Linking call wakes
  // the app. We strip the `lightning:` prefix and hand the bare LNURL
  // (or LUD-17 / https URL) to HuntFoundScreen via the navigation ref;
  // resolveLnurlWithdraw normalises the rest. The screen falls back to
  // a friendly "couldn't claim" state for non-withdrawRequest payloads
  // (e.g. a LUD-06 LNURL-pay tag landed here by accident), which is the
  // simplest UX while a proper Hunt-vs-generic-LNURL split waits on
  // pay-flow integration. Cold-start case races the navigation tree's
  // mount, so we retry briefly until `navigationRef.isReady()`.
  useEffect(() => {
    let cancelled = false;
    // Very short in-memory dedupe to absorb the cold-start race where
    // both `getInitialURL()` and `addEventListener('url')` deliver the
    // SAME URL within a few hundred ms of JS init. Tens of seconds
    // would be safer, but persistent dedupe (across JS restarts via
    // AsyncStorage) turned out to over-fire when the user re-scans
    // the same tag in the same hour — stale storage swallowed
    // genuine fresh taps. The "Explore tab takes you to the cached
    // detail" bug was actually a different problem (deep-link
    // navigator didn't seed ExploreHome / Hunt below HuntPiggyDetail,
    // see `navigateToHuntPiggyDetail`); now that's fixed, 2 seconds
    // is plenty to catch the cold-start double-fire without
    // mis-blocking deliberate re-scans.
    const ROUTE_DEDUPE_MS = 2_000;
    let lastRouted: { url: string; at: number } | null = null;
    const route = (raw: string | null | undefined) => {
      if (cancelled || !raw) return;
      const trimmed = raw.trim();
      if (
        lastRouted &&
        lastRouted.url === trimmed &&
        Date.now() - lastRouted.at < ROUTE_DEDUPE_MS
      ) {
        console.log(`[Link] de-duped cold-start double-fire within ${ROUTE_DEDUPE_MS}ms`);
        return;
      }
      lastRouted = { url: trimmed, at: Date.now() };
      routeFresh(trimmed);
    };
    const routeFresh = (trimmed: string) => {
      // Truncate noisy URIs so the log doesn't blow past logcat's
      // line limit but keep enough head + tail to identify them.
      const peek = trimmed.length > 96 ? trimmed.slice(0, 60) + '…' + trimmed.slice(-20) : trimmed;
      console.log(`[Link] received: ${peek}`);

      // `https://www.lightningpiggy.com/hunt/<coord>` (the canonical
      // form written as record 1 of an NFC tag) OR the legacy custom
      // `lightningpiggy://hunt/<coord>` scheme. Both decode the same
      // way. Coord is `kind:pubkey:d` percent-encoded.
      const lpHuntMatch = trimmed.match(
        /^(?:https?:\/\/(?:www\.)?lightningpiggy\.com\/hunt\/(.+)|lightningpiggy:\/\/hunt\/(.+))$/i,
      );
      if (lpHuntMatch) {
        const captured = lpHuntMatch[1] ?? lpHuntMatch[2];
        let coord: string;
        try {
          coord = decodeURIComponent(captured);
        } catch {
          console.warn(`[Link] hunt-URL coord decode failed: ${captured}`);
          return;
        }
        // Suppress the delayed system NDEF dispatch that fires ~600ms
        // after our in-app NfcReadSheet closes when the tag stays near
        // the antenna. Without this, the user gets yanked out of
        // HuntFoundScreen mid-claim back to HuntPiggyDetail.
        if (wasRecentlyRead(coord)) {
          console.log(`[Link] skipped — coord just read by foreground NFC: ${coord}`);
          return;
        }
        console.log(
          `[Link] → HuntPiggyDetail via ${trimmed.startsWith('https') ? 'https' : 'lightningpiggy://'} coord=${coord}`,
        );
        const tryNav = (attempt: number) => {
          if (navigateToHuntPiggyDetail(coord)) return;
          if (attempt >= 20 || cancelled) return;
          setTimeout(() => tryNav(attempt + 1), 100);
        };
        tryNav(0);
        return;
      }

      // `nostr:naddr1...` — record 2 of a Hunt tag, or a manual
      // share from a generic Nostr client. We decode the naddr to
      // recover { kind, pubkey, identifier } and assemble the same
      // `kind:pubkey:d` coord HuntPiggyDetail consumes. Non-Hunt
      // naddrs (other kinds) are ignored — no other screen handles
      // them yet, so silently dropping is better than hijacking.
      const nostrMatch = trimmed.match(/^nostr:(naddr1[0-9a-z]+)$/i);
      if (nostrMatch) {
        try {
          const decoded = nip19.decode(nostrMatch[1]);
          if (decoded.type === 'naddr' && decoded.data) {
            const { kind, pubkey: hex, identifier } = decoded.data;
            const coord = `${kind}:${hex}:${identifier}`;
            console.log(`[Link] → HuntPiggyDetail via nostr:naddr coord=${coord}`);
            const tryNav = (attempt: number) => {
              if (navigateToHuntPiggyDetail(coord)) return;
              if (attempt >= 20 || cancelled) return;
              setTimeout(() => tryNav(attempt + 1), 100);
            };
            tryNav(0);
            return;
          }
          console.warn(`[Link] nostr: URI decoded but not naddr — ignored (type=${decoded.type})`);
        } catch (err) {
          console.warn(`[Link] nostr: naddr decode failed: ${(err as Error)?.message ?? err}`);
          // Fall through to the lightning: path if the naddr is
          // garbage; otherwise the URI is ignored.
        }
      }

      if (!/^lightning:/i.test(trimmed)) {
        console.log(`[Link] ignored: no handler for scheme`);
        return;
      }
      const lnurl = trimmed.slice('lightning:'.length).trim();
      if (!lnurl) return;
      // Only route Hunt-eligible payloads (LNURL-withdraw forms) into
      // HuntFound. Bolt11 invoices (`lnbc…`), LNURL-pay (`lnurl1…` may
      // be either kind — accept and let HuntFound disambiguate),
      // Lightning Addresses (`user@host`), and raw https URLs land
      // elsewhere in the future pay-flow integration, so we ignore
      // them here rather than hijacking the URI. Per Copilot review
      // on PR #488: previous logic routed every `lightning:` URI into
      // HuntFound which would have hijacked invoice / pay-link shares.
      const isHuntEligible =
        /^lnurl1/i.test(lnurl) || /^lnurlw:\/\//i.test(lnurl) || /^lnurl:\/\//i.test(lnurl);
      if (!isHuntEligible) {
        // Otherwise the user lands in LP with no feedback when the
        // OS routes a non-Hunt `lightning:` URI here (bolt11 invoice,
        // LNURL-pay, raw https, Lightning Address). Surface a toast so
        // they know the link type isn't supported yet, instead of a
        // silent dead end (Copilot review #488). Full pay-flow
        // integration would absorb these into SendSheet — until then
        // the toast nudges them to use a wallet that does handle the
        // URI type.
        Toast.show({
          type: 'info',
          text1: 'Link not supported yet',
          text2:
            "Lightning Piggy currently opens `lightning:lnurl…` withdraw tags. Bolt11 invoices and pay links aren't routed yet.",
          visibilityTime: 4500,
        });
        return;
      }
      const tryNav = (attempt: number) => {
        if (navigateToHuntFound(lnurl)) return;
        if (attempt >= 20 || cancelled) return;
        setTimeout(() => tryNav(attempt + 1), 100);
      };
      tryNav(0);
    };
    Linking.getInitialURL().then(route);
    const sub = Linking.addEventListener('url', (e) => route(e.url));
    return () => {
      cancelled = true;
      sub.remove();
    };
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
                {/* TrustGraphProvider derives the L1+L2 web-of-trust set
                    from Nostr contacts. Lives inside NostrProvider so it
                    can read `contacts` + `pubkey`, but outside Groups
                    because nothing else depends on it. */}
                <TrustGraphProvider>
                  {/* GroupsProvider sits inside Nostr so groups can subscribe
                    to multi-recipient gift wraps using the active signer. */}
                  <GroupsProvider>
                    {/* UserLocationProvider: ONE GPS watch subscription
                        shared across every map surface, so all screens
                        see the same live position + accuracy halo and
                        we don't fan out to N concurrent watches. */}
                    <UserLocationProvider>
                      <BottomSheetModalProvider>
                        <ThemedStatusBar />
                        {/* Sits above the navigator so a single banner
                            covers every screen + tab when the device
                            loses connectivity. Slides on/off via the
                            internal `isConnected` check — no layout
                            penalty when online (returns null). See #634. */}
                        <OfflineBanner />
                        <AppNavigator />
                      </BottomSheetModalProvider>
                    </UserLocationProvider>
                    {/* BrandedToast: brand-themed wrapper around
                      `react-native-toast-message`. Single mount for the
                      app's toast slot — keeps styling (pink success
                      accent, red error, rounded corners + shadow that
                      mirror BrandedAlert) in one place. ESLint blocks
                      direct imports of the underlying lib elsewhere. */}
                    <BrandedToast />
                    <GlobalIncomingPaymentOverlay />
                    {/* BrandedAlertHost: portal target for the on-brand
                      BrandedAlert dialog. Sits at the root so any sheet /
                      screen that calls `Alert.alert(...)` (the BrandedAlert
                      drop-in re-export, NOT the system Alert) renders
                      above the rest of the UI without z-index gymnastics. */}
                    <BrandedAlertHost />
                  </GroupsProvider>
                </TrustGraphProvider>
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
