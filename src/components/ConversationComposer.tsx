import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { Plus, Send } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import {
  KeyboardStickyView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

/**
 * Shared composer for 1:1 (ConversationScreen) and group
 * (GroupConversationScreen) chats. See issue #251 — both screens used to
 * own their own composer + keyboard-handling code; PR #250 already
 * converged the keyboard wrapper. This component finishes the dedupe so
 * the composer's IME behaviour, padding, and attach-panel placement
 * can't drift again.
 *
 * The keyboard wrapping is the deliberate single source of truth: every
 * call site gets `KeyboardStickyView` + `useReanimatedKeyboardAnimation`
 * via this component. The animated paddingBottom transitions between
 * `8 + insets.bottom` (closed → composer sits above the gesture bar) and
 * `8` (open → composer hugs the keyboard's top edge with no whitespace
 * gap). This matches RNKC's canonical chat pattern documented in
 * ConversationScreen.tsx.
 *
 * Style overrides (sendButtonVariant, attachButtonHasBackground,
 * composerPaddingHorizontal) preserve the small visual differences the
 * two screens shipped with — the group chat uses a larger paper-plane
 * send button and a transparent attach button, while 1:1 uses the
 * compact lucide Send icon and a light-grey attach background. Picking
 * one would have been a UX regression in the other; the divergence is
 * documented at each prop site.
 */
export interface ConversationComposerProps {
  /** Current draft text. Controlled by the parent so it can persist or pre-fill. */
  value: string;
  onChangeText: (text: string) => void;
  /** Called when the user taps Send. Send button is disabled when value is empty. */
  onSend: () => void;
  /** Whether a send is in flight. Disables the input + swaps the send icon for a spinner. */
  sending: boolean;
  /** Toggles the inline attach panel open/closed. Parent owns the panel-open state. */
  onAttachToggle: () => void;
  attachOpen: boolean;
  /** Disables the Attach button (e.g. while a location share or image upload is mid-flight). */
  attachDisabled?: boolean;
  /** Called when the input gains focus — typical use is to close the attach panel. */
  onInputFocus?: () => void;
  /** Renders a spinner on the Attach button instead of the Plus icon. */
  attachLoading?: boolean;
  /** AttachPanel content. Rendered above the composer row when `attachOpen` is true. */
  attachPanel?: React.ReactNode;
  /** Placeholder text shown when the input is empty. */
  placeholder?: string;
  /** When true the input + send are gated even with non-empty text (e.g. logged out). */
  disabled?: boolean;
  /**
   * Visual variant for the send button. 1:1 uses the compact lucide Send
   * icon (40×40, no disabled-opacity); group uses an inline paper-plane
   * SVG (44×44, opacity 0.4 when disabled). Default: 'icon'.
   */
  sendButtonVariant?: 'icon' | 'paper-plane';
  /**
   * 1:1 has a light-grey circular background on the Attach button; group
   * uses a transparent button. Default: false (transparent).
   */
  attachButtonHasBackground?: boolean;
  /** Composer container horizontal padding. 1:1 ships 10, group ships 12. Default 10. */
  composerPaddingHorizontal?: number;
  testIDs?: {
    input?: string;
    attach?: string;
    send?: string;
  };
  accessibilityLabels?: {
    input?: string;
    attach?: string;
    send?: string;
  };
}

const ConversationComposer: React.FC<ConversationComposerProps> = ({
  value,
  onChangeText,
  onSend,
  sending,
  onAttachToggle,
  attachOpen,
  attachDisabled = false,
  onInputFocus,
  attachLoading = false,
  attachPanel,
  placeholder = 'Message',
  disabled = false,
  sendButtonVariant = 'icon',
  attachButtonHasBackground = false,
  composerPaddingHorizontal = 10,
  testIDs,
  accessibilityLabels,
}) => {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(
    () =>
      createStyles(colors, {
        paddingHorizontal: composerPaddingHorizontal,
        attachButtonHasBackground,
      }),
    [colors, composerPaddingHorizontal, attachButtonHasBackground],
  );

  // Drives the composer's animated paddingBottom: when the keyboard is
  // closed we leave insets.bottom of dead space so the input row sits
  // above the gesture bar; as the keyboard opens we shrink that to 0
  // so the input hugs the keyboard's top edge with no whitespace gap.
  // Identical to ConversationScreen.tsx's prior in-screen wiring.
  const keyboard = useReanimatedKeyboardAnimation();
  const composerSafeAreaStyle = useAnimatedStyle(() => ({
    paddingBottom: 8 + Math.max(insets.bottom * (1 + keyboard.progress.value * -1), 0),
  }));

  const sendDisabled = disabled || !value.trim() || sending;
  const inputDisabled = disabled || sending;

  return (
    <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
      {attachOpen ? attachPanel : null}
      <Animated.View style={[styles.composer, composerSafeAreaStyle]}>
        <TouchableOpacity
          style={styles.attachButton}
          onPress={onAttachToggle}
          disabled={disabled || sending || attachDisabled}
          accessibilityLabel={accessibilityLabels?.attach ?? 'Attach'}
          testID={testIDs?.attach}
        >
          {attachLoading ? (
            <ActivityIndicator color={colors.brandPink} />
          ) : (
            <Plus size={22} color={colors.brandPink} />
          )}
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={colors.textSupplementary}
          value={value}
          onChangeText={onChangeText}
          onFocus={onInputFocus}
          multiline
          editable={!inputDisabled}
          accessibilityLabel={accessibilityLabels?.input ?? 'Message input'}
          testID={testIDs?.input}
        />
        {sendButtonVariant === 'paper-plane' ? (
          <TouchableOpacity
            style={[styles.sendButtonLarge, sendDisabled && styles.sendButtonDisabled]}
            onPress={onSend}
            disabled={sendDisabled}
            accessibilityLabel={accessibilityLabels?.send ?? 'Send message'}
            testID={testIDs?.send}
          >
            {sending ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"
                  stroke={colors.white}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.sendButton}
            onPress={onSend}
            disabled={sendDisabled}
            accessibilityLabel={accessibilityLabels?.send ?? 'Send message'}
            testID={testIDs?.send}
          >
            {sending ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Send size={20} color={colors.white} />
            )}
          </TouchableOpacity>
        )}
      </Animated.View>
    </KeyboardStickyView>
  );
};

const createStyles = (
  colors: Palette,
  opts: { paddingHorizontal: number; attachButtonHasBackground: boolean },
) =>
  StyleSheet.create({
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: opts.paddingHorizontal,
      paddingTop: 8,
      gap: 8,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    input: {
      flex: 1,
      minHeight: 40,
      maxHeight: 120,
      backgroundColor: colors.background,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 10,
      fontSize: 15,
      color: colors.textBody,
    },
    attachButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: opts.attachButtonHasBackground ? colors.background : 'transparent',
    },
    sendButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendButtonLarge: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendButtonDisabled: {
      opacity: 0.4,
    },
  });

export default ConversationComposer;
