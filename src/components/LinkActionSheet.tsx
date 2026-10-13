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
  const actionRef = useRef<(() => void) | null>(null);
  const [prompt, setPrompt] = useState<LinkActionPrompt | null>(null);
  useEffect(() => {
    const unregister = registerLinkActionSheet((next) => {
      pendingRef.current?.options.onDismiss?.();
      actionRef.current = null;
      pendingRef.current = next;
      setPrompt(next);
      sheetRef.current?.present();
    });
    return () => {
      unregister();
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
      onDismiss={() => {
        pendingRef.current?.options.onDismiss?.();
        pendingRef.current = null;
        setPrompt(null);
        const action = actionRef.current;
        actionRef.current = null;
        action?.();
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
