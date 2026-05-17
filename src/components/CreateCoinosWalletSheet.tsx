import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Keyboard,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { useWallet } from '../contexts/WalletContext';
import * as coinosService from '../services/coinosService';
import * as walletStorage from '../services/walletStorageService';
import CoinosRecoverySheet, { CoinosRecoveryDetails } from './CoinosRecoverySheet';

// custody → creating → recovery. Username + password are auto-generated
// per #287 so the user has zero typing to do; they only need to
// acknowledge the custody disclosure and then save the recovery info.
type Step = 'custody' | 'creating' | 'recovery';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Fired after the user has acknowledged the recovery info — the parent
   *  can then close any wrapping wizard / route the user back to Home. */
  onComplete?: () => void;
}

/**
 * Step 1: honest custody disclosure. Step 2: spinner while we register
 * + mint the NWC connection. Step 3: mandatory recovery-info screen the
 * user MUST acknowledge before we let them onto Home.
 *
 * The sheet is the create-only entry point. After creation, the user
 * can re-display the same recovery info from Wallet Settings → "View
 * recovery info" via `CoinosRecoverySheet` directly.
 */
const CreateCoinosWalletSheet: React.FC<Props> = ({ visible, onClose, onComplete }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { addNwcWallet, setActiveWallet } = useWallet();
  const ref = useRef<BottomSheetModal>(null);
  // No explicit snapPoints — content-height only. Matches the rest of
  // the app's sheet convention (AddWalletWizard, NostrLoginSheet, …)
  // and avoids the empty whitespace a 90% pin leaves under the Cancel
  // button on the short custody step.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const [step, setStep] = useState<Step>('custody');
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [baseUrl, setBaseUrl] = useState(coinosService.DEFAULT_COINOS_BASE_URL);
  const [probing, setProbing] = useState(false);
  const [recovery, setRecovery] = useState<CoinosRecoveryDetails | null>(null);
  // Track the wallet id that addNwcWallet just minted so we can persist
  // the CoinOS recovery info against the right id and switch to it
  // before exiting.
  const newlyCreatedWalletIdRef = useRef<string | null>(null);
  // Flip to true when the sheet is dismissed mid-flow so the
  // `handleConfirmCustody` async chain (probe → register → mint → save)
  // can bail before doing more work. Without this, dismissing during
  // the self-hosted /health probe would still go on to register the
  // user and mint an NWC connection in the background.
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (visible) {
      // Reset every time the sheet opens — half-finished state from a
      // previously-cancelled attempt would otherwise carry over.
      setStep('custody');
      setError(null);
      setShowAdvanced(false);
      setBaseUrl(coinosService.DEFAULT_COINOS_BASE_URL);
      setRecovery(null);
      newlyCreatedWalletIdRef.current = null;
      cancelledRef.current = false;
      ref.current?.present();
    } else {
      cancelledRef.current = true;
      ref.current?.dismiss();
    }
  }, [visible]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) {
        // If user swipes away mid-create, let parent know so wizards can
        // close. We don't persist partial state — the user will re-do
        // step 1 next time.
        onClose();
      }
    },
    [onClose],
  );

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        // While we're mid-create, lock the backdrop so the user can't
        // accidentally cancel a half-finished registration. They can
        // still tap the explicit Cancel button if we surface one.
        pressBehavior={step === 'creating' ? 'none' : 'close'}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
      />
    ),
    [step],
  );

  // Single handler: probe (if self-hosted) → register → mint NWC →
  // surface recovery. Username + password are auto-generated so the user
  // has zero text input. If the server rejects the username (collision
  // on the random suffix is theoretically possible), retry with a fresh
  // suggestion up to MAX_RETRIES times before surfacing the failure.
  const handleConfirmCustody = useCallback(async () => {
    setError(null);
    if (baseUrl !== coinosService.DEFAULT_COINOS_BASE_URL) {
      setProbing(true);
      const ok = await coinosService.probeCoinosInstance(baseUrl).finally(() => setProbing(false));
      // Bail if the user dismissed the sheet during the /health probe —
      // we don't want to silently register a CoinOS account in the
      // background after the UI has been closed.
      if (cancelledRef.current) return;
      if (!ok) {
        setError('Could not reach that CoinOS instance. Check the URL and try again.');
        return;
      }
    }
    setStep('creating');

    const password = coinosService.generateStrongPassword();
    const MAX_RETRIES = 3;
    let lastError: Error | null = null;
    let username = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (cancelledRef.current) return;
      username = coinosService.suggestUsername();
      try {
        const reg = await coinosService.registerCoinosUser({ baseUrl, username, password });
        if (cancelledRef.current) return;
        const minted = await coinosService.createCoinosNwcConnection({
          baseUrl,
          token: reg.token,
          name: 'Lightning Piggy',
        });

        const result = await addNwcWallet(minted.nwc, 'CoinOS', 'coinos');
        if (!result.success || !result.walletId) {
          setStep('custody');
          setError(result.error || 'Lightning Piggy could not connect to the new CoinOS wallet.');
          return;
        }

        // Use the id addNwcWallet just minted — scanning wallets[] by
        // alias / theme broke on a second create because find() returned
        // the FIRST CoinOS-themed wallet, not the newest, so recovery
        // info got stashed against the wrong walletId and never showed
        // in Settings for the actual fresh wallet.
        const newId = result.walletId;
        newlyCreatedWalletIdRef.current = newId;
        await walletStorage.saveCoinosRecovery(newId, {
          baseUrl,
          username,
          password,
          createdAt: new Date().toISOString(),
        });

        setRecovery({ baseUrl, username, password, nwc: minted.nwc });
        setStep('recovery');
        return;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        // Only retry on username collision — anything else is fatal
        // (rate limit, network, service down).
        if (
          e instanceof coinosService.CoinosError &&
          e.code === 'username_taken' &&
          attempt < MAX_RETRIES - 1
        ) {
          continue;
        }
        break;
      }
    }

    setStep('custody');
    setError(
      lastError instanceof coinosService.CoinosError
        ? coinosErrorCopy(lastError)
        : lastError instanceof Error
          ? lastError.message
          : 'Something went wrong creating your CoinOS wallet.',
    );
  }, [addNwcWallet, baseUrl]);

  const handleAcknowledge = useCallback(() => {
    // Make sure the new wallet is selected as active before we exit so
    // the user lands on Home with their freshly-minted wallet front and
    // centre — matches the issue's Step 5.
    if (newlyCreatedWalletIdRef.current) {
      setActiveWallet(newlyCreatedWalletIdRef.current);
    }
    setRecovery(null);
    onComplete?.();
    onClose();
  }, [onClose, onComplete, setActiveWallet]);

  return (
    <>
      <BottomSheetModal
        ref={ref}
        // While we're creating we lock the swipe so a half-finished
        // registration can't be silently abandoned.
        enablePanDownToClose={step !== 'creating'}
        onChange={handleSheetChange}
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.handle}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
      >
        <BottomSheetScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 40 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {step === 'custody' && (
            <View style={styles.section}>
              <View style={styles.iconBubble}>
                <ShieldAlert size={36} color={colors.white} strokeWidth={2.5} />
              </View>
              <Text style={styles.title}>Create a Lightning wallet</Text>
              <Text style={styles.subtitle}>
                Lightning Piggy will set up a managed Lightning wallet for you on CoinOS so you can
                start sending and receiving in seconds — no setup, no seed phrase to write down
                today.
              </Text>

              <View style={styles.warningCard} testID="coinos-custody-warning">
                <Text style={styles.warningTitle}>Heads-up: this is a custodial wallet</Text>
                <Text style={styles.warningBody}>
                  Your funds will be held by CoinOS, not by you. Suitable for testing or small
                  amounts &mdash; not life savings. You can move to self-custody whenever
                  you&apos;re ready.
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => setShowAdvanced((v) => !v)}
                style={styles.advancedToggle}
                accessibilityLabel="Toggle advanced settings"
                testID="coinos-advanced-toggle"
              >
                <Text style={styles.advancedToggleText}>
                  Advanced: use a self-hosted CoinOS instance
                </Text>
                {showAdvanced ? (
                  <ChevronUp size={18} color={colors.textSupplementary} />
                ) : (
                  <ChevronDown size={18} color={colors.textSupplementary} />
                )}
              </TouchableOpacity>

              {showAdvanced && (
                <View style={styles.advancedBlock}>
                  <Text style={styles.advancedLabel}>CoinOS server URL</Text>
                  <BottomSheetTextInput
                    style={styles.input}
                    value={baseUrl}
                    onChangeText={(v) => {
                      setBaseUrl(v);
                      setError(null);
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    placeholder="https://coinos.example.com/api"
                    placeholderTextColor={colors.textSupplementary}
                    testID="coinos-base-url-input"
                  />
                  <Text style={styles.advancedHint}>
                    Leave as {coinosService.DEFAULT_COINOS_BASE_URL} for the public managed
                    instance, or paste the URL of a CoinOS API server you trust. Include the `/api`
                    path suffix — the bare host serves a frontend that won&apos;t accept register
                    requests.
                  </Text>
                </View>
              )}

              {error && (
                <Text style={styles.errorText} testID="coinos-create-error">
                  {error}
                </Text>
              )}

              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleConfirmCustody}
                disabled={probing}
                accessibilityLabel="Create CoinOS managed Lightning wallet"
                testID="coinos-create-button"
              >
                {probing ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.primaryButtonText}>Create my wallet</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={onClose}
                style={styles.cancelButton}
                accessibilityLabel="Cancel CoinOS wallet creation"
                testID="coinos-create-cancel"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 'creating' && (
            <View style={styles.creatingBlock} testID="coinos-creating">
              <ActivityIndicator size="large" color={colors.brandPink} />
              <Text style={styles.creatingTitle}>
                {probing ? 'Checking your CoinOS instance…' : 'Creating your wallet on CoinOS…'}
              </Text>
              <Text style={styles.creatingHint}>
                Picking a username, generating a strong password, and minting a Nostr Wallet Connect
                connection. This usually takes a few seconds.
              </Text>
            </View>
          )}
        </BottomSheetScrollView>
      </BottomSheetModal>

      {/* Step 4: mandatory recovery-info acknowledgement. Renders as a
          separate sheet so its `enablePanDownToClose={false}` lock isn't
          tangled up with the create sheet's lifecycle. */}
      <CoinosRecoverySheet
        visible={step === 'recovery' && !!recovery}
        details={recovery}
        requireAcknowledge
        onAcknowledge={handleAcknowledge}
        onClose={handleAcknowledge}
      />
    </>
  );
};

/** Map structured CoinOS errors to user-facing copy. */
function coinosErrorCopy(err: coinosService.CoinosError): string {
  switch (err.code) {
    case 'username_taken':
      return 'CoinOS rejected the auto-generated username. Tap Create again to retry with a fresh one.';
    case 'rate_limited':
      return 'CoinOS is rate-limiting registrations right now. Try again in a minute.';
    case 'service_down':
      return 'CoinOS appears to be down. Try again in a few minutes.';
    case 'network':
      return "Couldn't reach CoinOS. Check your connection and try again.";
    case 'timeout':
      return 'CoinOS took too long to respond. Try again.';
    case 'auth':
      return 'CoinOS rejected the request — please report this to Lightning Piggy support.';
    case 'invalid_input':
      return err.message;
    default:
      return err.message || 'Something went wrong creating your CoinOS wallet.';
  }
}

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handle: {
      backgroundColor: colors.divider,
      width: 40,
    },
    content: {
      padding: 24,
      paddingBottom: 40,
      gap: 16,
    },
    section: {
      gap: 16,
    },
    iconBubble: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 14,
      color: colors.textBody,
      lineHeight: 20,
      textAlign: 'center',
    },
    warningCard: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 16,
      gap: 6,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    warningTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textHeader,
    },
    warningBody: {
      fontSize: 13,
      color: colors.textSupplementary,
      lineHeight: 18,
    },
    advancedToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 8,
    },
    advancedToggleText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    advancedBlock: {
      gap: 8,
    },
    advancedLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSupplementary,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    advancedHint: {
      fontSize: 12,
      color: colors.textSupplementary,
      lineHeight: 16,
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
      fontSize: 15,
      color: colors.textBody,
    },
    errorText: {
      color: colors.red,
      fontSize: 14,
      fontWeight: '600',
      textAlign: 'center',
    },
    primaryButton: {
      backgroundColor: colors.brandPink,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 4,
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    cancelButton: {
      height: 44,
      justifyContent: 'center',
      alignItems: 'center',
    },
    cancelButtonText: {
      color: colors.textBody,
      fontSize: 14,
      fontWeight: '600',
    },
    creatingBlock: {
      alignItems: 'center',
      gap: 16,
      padding: 32,
    },
    creatingTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    creatingHint: {
      fontSize: 13,
      color: colors.textSupplementary,
      lineHeight: 18,
      textAlign: 'center',
    },
  });

export default CreateCoinosWalletSheet;
