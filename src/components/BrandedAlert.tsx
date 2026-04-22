import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { AlertCircle, Check, Info, X } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

export type BrandedAlertButtonStyle = 'default' | 'cancel' | 'destructive';

export interface BrandedAlertButton {
  text: string;
  style?: BrandedAlertButtonStyle;
  onPress?: () => void;
}

export type BrandedAlertKind = 'info' | 'error' | 'success' | 'confirm';

export interface BrandedAlertOptions {
  cancelable?: boolean;
  onDismiss?: () => void;
}

interface AlertPayload {
  id: number;
  title: string;
  message?: string;
  buttons: BrandedAlertButton[];
  kind: BrandedAlertKind;
  options?: BrandedAlertOptions;
}

type Listener = (payload: AlertPayload) => void;

const noop = () => {};

let listener: Listener | null = null;
// Monotonically-increasing id used as the Modal's React `key`, so a
// second alert raised while the first is still visible remounts the
// Modal and re-runs its fade-in animation (rather than silently swapping
// the content underneath an already-presented dialog).
let nextId = 1;

function inferKind(title: string, buttons: BrandedAlertButton[]): BrandedAlertKind {
  if (buttons.some((b) => b.style === 'destructive')) return 'confirm';
  if (buttons.length > 1 && buttons.some((b) => b.style === 'cancel')) return 'confirm';
  const lower = title.toLowerCase();
  if (/fail|error|invalid|could not|unable|denied|needed|required/.test(lower)) return 'error';
  if (/saved|updated|copied|complete|published|success|done|enabled/.test(lower)) return 'success';
  return 'info';
}

function alertImpl(
  title: string,
  message?: string,
  buttons?: BrandedAlertButton[],
  options?: BrandedAlertOptions,
): void {
  const btns = buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }];
  const payload: AlertPayload = {
    id: nextId++,
    title,
    message,
    buttons: btns,
    kind: inferKind(title, btns),
    options,
  };
  if (listener) {
    listener(payload);
  } else if (__DEV__) {
    console.warn('[BrandedAlert] host is not mounted; dropping alert:', title);
  }
}

// Drop-in for React Native's `Alert` — `Alert.alert(title, message?, buttons?)`.
export const Alert = { alert: alertImpl };

// Functional alias for callers that prefer a bare function.
export const alert = alertImpl;

export function BrandedAlertHost(): React.ReactElement | null {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [payload, setPayload] = useState<AlertPayload | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    listener = (p) => {
      if (mountedRef.current) setPayload(p);
    };
    return () => {
      mountedRef.current = false;
      listener = null;
    };
  }, []);

  const close = () => setPayload(null);

  const handleButton = (btn: BrandedAlertButton) => {
    close();
    // Defer onPress so the dismiss animation can start before any follow-up
    // UI work (which may itself raise another alert) runs.
    if (btn.onPress) setTimeout(btn.onPress, 0);
  };

  // Dismiss without a button press — triggered by the hardware back button
  // or a backdrop tap when the alert is cancelable. Matches RN Alert's
  // `options.onDismiss` semantic so existing call sites behave the same way.
  const handleDismiss = () => {
    const onDismiss = payload?.options?.onDismiss;
    close();
    if (onDismiss) setTimeout(onDismiss, 0);
  };

  if (!payload) return null;

  const cancelable = payload.options?.cancelable ?? true;

  // Icon treatment mirrors PaymentProgressOverlay: a 72x72 solid-colour
  // circle with a white glyph, so alerts and payment toasts feel like
  // siblings from the same family.
  const { Icon, iconBg } =
    payload.kind === 'error'
      ? { Icon: X, iconBg: colors.red }
      : payload.kind === 'success'
        ? { Icon: Check, iconBg: colors.green }
        : payload.kind === 'confirm'
          ? { Icon: AlertCircle, iconBg: colors.brandPink }
          : { Icon: Info, iconBg: colors.brandPink };

  const stackButtons = payload.buttons.length > 2;

  return (
    <Modal
      key={payload.id}
      visible
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={cancelable ? handleDismiss : noop}
    >
      <Pressable
        style={styles.root}
        onPress={cancelable ? handleDismiss : undefined}
        accessible={cancelable}
        accessibilityLabel={cancelable ? 'Dismiss alert' : undefined}
      >
        <View
          onStartShouldSetResponder={() => true}
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={`${payload.title}${payload.message ? `. ${payload.message}` : ''}`}
          style={styles.card}
          testID="branded-alert"
        >
          <View style={[styles.iconSlot, { backgroundColor: iconBg }]}>
            <Icon size={44} color={colors.white} strokeWidth={3.5} />
          </View>
          <Text style={styles.title} testID="branded-alert-title">
            {payload.title}
          </Text>
          {payload.message ? (
            <Text style={styles.subtitle} testID="branded-alert-message">
              {payload.message}
            </Text>
          ) : null}
          <View style={[styles.buttonRow, stackButtons ? styles.buttonColumn : null]}>
            {payload.buttons.map((btn, idx) => {
              const isCancel = btn.style === 'cancel';
              const isDestructive = btn.style === 'destructive';
              return (
                <Pressable
                  key={`${idx}-${btn.text}`}
                  onPress={() => handleButton(btn)}
                  style={({ pressed }) => [
                    styles.button,
                    isCancel
                      ? styles.cancelButton
                      : isDestructive
                        ? styles.destructiveButton
                        : styles.primaryButton,
                    pressed ? styles.buttonPressed : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={btn.text}
                  testID={`branded-alert-button-${idx}`}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      isCancel ? styles.cancelButtonText : styles.actionButtonText,
                    ]}
                  >
                    {btn.text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

// Styles mirror PaymentProgressOverlay so send/receive confirmations and
// system alerts feel like siblings from the same family. Factory shape
// (rather than module-level `StyleSheet.create`) so the dialog reads
// the live theme palette via `useThemeColors()` — light/dark switch
// applies without restart.
const createStyles = (colors: Palette) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: 'rgba(21, 23, 26, 0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 28,
      paddingVertical: 32,
      paddingHorizontal: 28,
      minWidth: 260,
      maxWidth: 340,
      alignItems: 'center',
      gap: 14,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.2,
      shadowRadius: 24,
      elevation: 12,
    },
    iconSlot: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
      lineHeight: 20,
    },
    buttonRow: {
      flexDirection: 'row',
      alignSelf: 'stretch',
      gap: 10,
      marginTop: 6,
    },
    buttonColumn: {
      flexDirection: 'column-reverse',
    },
    button: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButton: {
      backgroundColor: colors.brandPink,
    },
    destructiveButton: {
      backgroundColor: colors.red,
    },
    cancelButton: {
      backgroundColor: colors.background,
    },
    buttonPressed: {
      opacity: 0.75,
    },
    buttonText: {
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    actionButtonText: {
      color: colors.white,
    },
    cancelButtonText: {
      color: colors.textBody,
    },
  });

export default Alert;
