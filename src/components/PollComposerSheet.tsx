import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Platform,
  View,
} from 'react-native';
import { Alert } from './BrandedAlert';
import { Plus, X } from 'lucide-react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import {
  buildPollMessage,
  POLL_MAX_OPTIONS,
  POLL_MAX_OPTION_LENGTH,
  POLL_MAX_QUESTION_LENGTH,
  POLL_MIN_OPTIONS,
} from '../utils/pollMessage';

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Called with the serialised poll body (the same string the renderer
   * later parses with `parsePoll`). The parent owns the actual send via
   * its existing `sendDirectMessage` / `sendGroupMessage` path so polls
   * inherit the same retry / Toast / optimistic-append behaviour as
   * other attachment types. Returns `true` on a successful send so we
   * know to dismiss the sheet (vs. staying open on failure for retry).
   */
  onSend: (pollBody: string) => Promise<boolean>;
}

/**
 * Composer for in-conversation polls (#203). Mirrors RenameGroupSheet's
 * structure for keyboard handling + backdrop + Android back routing.
 *
 * Validation lives in `buildPollMessage` (single source of truth). The
 * sheet's own `canSend` predicate is just a UX gate for the Send button;
 * builder errors still surface as a BrandedAlert in case the user sneaks
 * past it (e.g. paste-and-send racing the validation tick).
 */
const PollComposerSheet: React.FC<Props> = ({ visible, onClose, onSend }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [question, setQuestion] = useState('');
  // Start with the minimum option count — empty strings give the user a
  // clear "fill these in" affordance without forcing them to tap "Add"
  // before they can compose anything meaningful.
  const [options, setOptions] = useState<string[]>(['', '']);
  const [sending, setSending] = useState(false);

  // Canonical keyboard tracking — same shape as RenameGroupSheet etc.
  // Without this, a tall keyboard hides the Send button on Android.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Reset state every time the sheet is presented anew so the previous
  // poll's draft doesn't leak across sends. Dismissing without sending
  // also clears via the same path because `visible` toggles to false.
  useEffect(() => {
    if (visible) {
      setQuestion('');
      setOptions(['', '']);
      setSending(false);
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const handleAddOption = useCallback(() => {
    setOptions((prev) => {
      if (prev.length >= POLL_MAX_OPTIONS) return prev;
      return [...prev, ''];
    });
  }, []);

  const handleRemoveOption = useCallback((index: number) => {
    setOptions((prev) => {
      // Never let the user delete below the minimum — the Remove button
      // on those rows is hidden, but enforce here too in case of races.
      if (prev.length <= POLL_MIN_OPTIONS) return prev;
      const next = prev.slice();
      next.splice(index, 1);
      return next;
    });
  }, []);

  const handleChangeOption = useCallback((index: number, text: string) => {
    setOptions((prev) => {
      const next = prev.slice();
      next[index] = text;
      return next;
    });
  }, []);

  // Send-button gate — mirrors the validation in buildPollMessage but
  // returns a boolean so the button can grey out without throwing.
  const canSend = useMemo(() => {
    if (sending) return false;
    if (question.trim().length === 0) return false;
    const filled = options.map((o) => o.trim()).filter((o) => o.length > 0);
    return filled.length >= POLL_MIN_OPTIONS;
  }, [question, options, sending]);

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    let body: string;
    try {
      body = buildPollMessage(question, options);
    } catch (err) {
      Alert.alert('Could not send poll', err instanceof Error ? err.message : 'Invalid poll.');
      return;
    }
    setSending(true);
    try {
      const ok = await onSend(body);
      if (ok) {
        onClose();
      }
    } finally {
      setSending(false);
    }
  }, [canSend, question, options, onSend, onClose]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      enableDynamicSizing
    >
      <BottomSheetScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Create a poll</Text>
        <Text style={styles.subtitle}>
          Ask a question and add up to {POLL_MAX_OPTIONS} options. Recipients can vote inline.
        </Text>

        <Text style={styles.label}>Question</Text>
        <BottomSheetTextInput
          style={styles.input}
          placeholder="e.g. What shall we cook tonight?"
          placeholderTextColor={colors.textSupplementary}
          value={question}
          onChangeText={setQuestion}
          autoCapitalize="sentences"
          autoCorrect
          autoFocus
          maxLength={POLL_MAX_QUESTION_LENGTH}
          accessibilityLabel="Poll question"
          testID="poll-composer-question"
        />

        <Text style={styles.label}>Options</Text>
        {options.map((opt, idx) => {
          const removable = options.length > POLL_MIN_OPTIONS;
          return (
            <View key={`opt-${idx}`} style={styles.optionRow}>
              <BottomSheetTextInput
                style={[styles.input, styles.optionInput]}
                placeholder={`Option ${idx + 1}`}
                placeholderTextColor={colors.textSupplementary}
                value={opt}
                onChangeText={(t) => handleChangeOption(idx, t)}
                autoCapitalize="sentences"
                autoCorrect
                maxLength={POLL_MAX_OPTION_LENGTH}
                accessibilityLabel={`Poll option ${idx + 1}`}
                testID={`poll-composer-option-${idx + 1}`}
              />
              {removable ? (
                <TouchableOpacity
                  onPress={() => handleRemoveOption(idx)}
                  style={styles.removeButton}
                  accessibilityLabel={`Remove option ${idx + 1}`}
                  testID={`poll-composer-remove-${idx + 1}`}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <X size={18} color={colors.textSupplementary} />
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}

        {options.length < POLL_MAX_OPTIONS ? (
          <TouchableOpacity
            style={styles.addButton}
            onPress={handleAddOption}
            accessibilityLabel="Add another option"
            testID="poll-composer-add"
          >
            <Plus size={16} color={colors.brandPink} />
            <Text style={styles.addButtonText}>Add option</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.maxedHint}>Maximum {POLL_MAX_OPTIONS} options.</Text>
        )}

        <TouchableOpacity
          style={[styles.sendButton, !canSend && styles.disabled]}
          onPress={handleSend}
          disabled={!canSend}
          accessibilityLabel="Send poll"
          testID="poll-composer-send"
        >
          {sending ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.sendButtonText}>Send poll</Text>
          )}
        </TouchableOpacity>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handleIndicator: {
      backgroundColor: colors.divider,
      width: 40,
    },
    content: {
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 40,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 6,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginBottom: 18,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
      marginTop: 8,
      marginBottom: 6,
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
      fontSize: 15,
      color: colors.textBody,
      fontWeight: '500',
      marginBottom: 10,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    optionInput: {
      flex: 1,
    },
    removeButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      marginBottom: 10,
    },
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 4,
      alignSelf: 'flex-start',
      marginBottom: 16,
    },
    addButtonText: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '700',
    },
    maxedHint: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginBottom: 16,
      marginTop: 4,
    },
    sendButton: {
      backgroundColor: colors.brandPink,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 8,
    },
    sendButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    disabled: {
      opacity: 0.5,
    },
  });

export default PollComposerSheet;
