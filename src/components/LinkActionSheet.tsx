import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { BottomSheetModal } from './AccessibleBottomSheetModal';
import { useThemeColors } from '../contexts/ThemeContext';
import { createLinkActionSheetStyles } from '../styles/LinkActionSheet.styles';
import { registerLinkActionSheet, type LinkActionPrompt } from '../utils/linkActionSheet';

/** Shared consent surface for links, camera scans and NFC input. */
export function LinkActionSheetHost(): React.ReactElement {
  const colors = useThemeColors();
  const styles = useMemo(() => createLinkActionSheetStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  const pendingRef = useRef<LinkActionPrompt | null>(null);
  const dismissingRef = useRef(false);
  const queuedRef = useRef<LinkActionPrompt[]>([]);
  const actionRef = useRef<(() => void) | null>(null);
  const [prompt, setPrompt] = useState<LinkActionPrompt | null>(null);
  useEffect(() => {
    const unregister = registerLinkActionSheet((next) => {
      if (dismissingRef.current || queuedRef.current.length > 0) {
        queuedRef.current.push(next);
        return;
      }
      pendingRef.current?.options.onDismiss?.();
      actionRef.current = null;
      pendingRef.current = next;
      setPrompt(next);
      sheetRef.current?.present();
    });
    return () => {
      unregister();
      queuedRef.current.forEach((queued) => queued.options.onDismiss?.());
      queuedRef.current = [];
      actionRef.current = null;
      pendingRef.current?.options.onDismiss?.();
    };
  }, []);
  const backdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    [],
  );
  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      backdropComponent={backdrop}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handle}
      onAnimate={(_from, to) => {
        if (to === -1) dismissingRef.current = true;
      }}
      onDismiss={() => {
        dismissingRef.current = true;
        pendingRef.current?.options.onDismiss?.();
        pendingRef.current = null;
        setPrompt(null);
        const action = actionRef.current;
        actionRef.current = null;
        // Keep arrivals queued while the accepted callback runs too.
        dismissingRef.current = true;
        action?.();
        dismissingRef.current = false;
        const next = queuedRef.current.shift();
        if (next) {
          pendingRef.current = next;
          setPrompt(next);
          sheetRef.current?.present();
        }
      }}
    >
      <BottomSheetView style={styles.content} testID="link-action-sheet">
        {prompt && (
          <>
            <Text style={styles.title}>{prompt.title}</Text>
            <Text style={styles.message}>{prompt.message}</Text>
            {prompt.buttons.map((button, index) => (
              <TouchableOpacity
                key={index}
                style={styles.button}
                testID={button.testID ?? `link-action-button-${index}`}
                accessibilityLabel={button.text}
                onPress={() => {
                  if (pendingRef.current !== prompt) return;
                  dismissingRef.current = true;
                  pendingRef.current = null;
                  actionRef.current = button.onPress ?? null;
                  sheetRef.current?.dismiss();
                }}
              >
                <Text style={styles.label}>{button.text}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
}
