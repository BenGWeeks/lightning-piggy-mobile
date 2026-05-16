// CRITICAL: Polyfills must be imported FIRST, before any other imports
import './src/polyfills';

import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import AppNavigator, {
  navigateToHuntFound,
  navigateToHuntPiggyDetail,
} from './src/navigation/AppNavigator';
import * as nip19 from 'nostr-tools/nip19';
import { wasRecentlyRead } from './src/services/nfcService';
import PaymentProgressOverlay from './src/components/PaymentProgressOverlay';
import BootSplash from './src/components/BootSplash';
import { BrandedAlertHost } from './src/components/BrandedAlert';
import { BrandedToast, Toast } from './src/components/BrandedToast';

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
    // De-dupe NFC-tag launch URLs across JS restarts. Android keeps
    // the NDEF_DISCOVERED intent attached to the activity's
    // `baseIntent`. Every time the OS resurrects the task (recents
    // switcher, low-memory restart, fresh process spawn) the
    // activity relaunches with that same intent, the JS bundle
    // starts fresh, and `Linking.getInitialURL()` returns the SAME
    // `lightningpiggy://hunt/<coord>` URL. Pre-fix that re-pushed
    // HuntPiggyDetail onto the Explore stack on every wake — the
    // user's "Explore tab keeps taking me back" symptom.
    //
    // In-memory dedupe alone doesn't work because the JS module
    // re-evaluates on each fresh process — `lastRouted` is reset to
    // null and we navigate again. The fix has to be persistent
    // across process boundaries → AsyncStorage. Window is 5 min:
    // generous enough to cover recents/wake within a session, short
    // enough that a genuine re-scan tomorrow still routes.
    const ROUTE_DEDUPE_MS = 5 * 60 * 1000;
    const DEDUPE_KEY = '@lp:last-routed-link-v1';
    let lastRouted: { url: string; at: number } | null = null;
    // Warm the in-memory copy from disk. The async read can lose the
    // race against `getInitialURL().then(route)` below — that's why
    // `route()` does its own disk check too, not just the memory
    // copy. Memory is the fast path; disk is the source of truth.
    AsyncStorage.getItem(DEDUPE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          lastRouted = JSON.parse(raw) as { url: string; at: number };
        } catch {
          // Bad value — drop it. Next route() write replaces it.
        }
      })
      .catch(() => {
        // Non-fatal — fall through to in-memory only.
      });
    const persistRouted = (entry: { url: string; at: number }) => {
      AsyncStorage.setItem(DEDUPE_KEY, JSON.stringify(entry)).catch(() => {
        // Non-fatal — next launch will route again, no worse than today.
      });
    };
    const isDuplicate = async (url: string): Promise<boolean> => {
      if (
        lastRouted &&
        lastRouted.url === url &&
        Date.now() - lastRouted.at < ROUTE_DEDUPE_MS
      ) {
        return true;
      }
      // Disk fallback for the race where getInitialURL fires before
      // the async load completes.
      try {
        const raw = await AsyncStorage.getItem(DEDUPE_KEY);
        if (!raw) return false;
        const stored = JSON.parse(raw) as { url: string; at: number };
        return stored.url === url && Date.now() - stored.at < ROUTE_DEDUPE_MS;
      } catch {
        return false;
      }
    };
    const route = (raw: string | null | undefined) => {
      if (cancelled || !raw) return;
      const trimmed = raw.trim();
      void isDuplicate(trimmed).then((dup) => {
        if (cancelled) return;
        if (dup) {
          console.log(`[Link] de-duped Android-resurrected NDEF intent within ${ROUTE_DEDUPE_MS}ms`);
          return;
        }
        const entry = { url: trimmed, at: Date.now() };
        lastRouted = entry;
        persistRouted(entry);
        routeFresh(trimmed);
      });
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
