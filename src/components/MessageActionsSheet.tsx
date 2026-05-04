import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, BackHandler } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { QUICK_REACTIONS } from '../utils/reactions';

/**
 * Per-message action sheet — opens on long-press of a `MessageBubble`.
 * Surfaces:
 *   - A row of canonical NIP-25 quick-reaction emojis (👍 ❤️ 😄 …) the
 *     viewer taps to publish a kind-7 reaction. Tapping the same emoji
 *     again toggles their reaction off (NIP-09 deletion). The active /
 *     "you've already reacted" state is highlighted via `myReactions`.
 *   - A Zap CTA. Visible only when the bubble's author has a Lightning
 *     payment route (the parent passes `zapEnabled=true` after the
 *     LNURL / LUD-16 lookup); when false, the row is hidden so we don't
 *     show a button that can never succeed.
 *
 * The sheet uses content-height sizing (no fixed snapPoints) per the
 * project convention — the action surface is short (one emoji row + one
 * CTA) so the sheet sizes itself just-tall-enough.
 *
 * UX note: per the issue's acceptance criteria, the bubble's `id` flows
 * through the parent's tap handlers, so this component is intentionally
 * stateless about *which* message it's acting on — the parent owns the
 * "currently-actioned message" state and re-presents the sheet for each.
 */
interface Props {
  /** Whether the sheet should be open. Driven by the parent's
   * `actionsForMessage` state — when non-null the sheet presents. */
  visible: boolean;
  /** Called on backdrop tap, hardware back, or after any inner action
   * tap. The parent should clear its actioned-message state here. */
  onClose: () => void;
  /** Map of `emoji → reactionId` for the viewer's current reactions on
   * the actioned message. An entry's presence drives the highlighted
   * "active" pill state; tapping an active emoji issues a NIP-09 delete
   * via `onToggleReaction(emoji, reactionId)`. */
  myReactions: Record<string, string>;
  /**
   * Tap handler for a quick-reaction emoji. Receives the emoji and (when
   * the viewer has already reacted with it) the reaction event id so the
   * parent can NIP-09-delete. When the viewer hasn't reacted yet,
   * `existingReactionId` is null and the parent should publish.
   */
  onToggleReaction: (emoji: string, existingReactionId: string | null) => void;
  /**
   * Tap handler for the Zap CTA. Parent typically opens SendSheet
   * pre-populated with the bubble's author's pubkey + lightning address.
   * If undefined, the Zap row is hidden — happens when the author has
   * no payment route, or for the viewer's own outgoing bubble (zapping
   * yourself doesn't make product sense).
   */
  onZap?: () => void;
}

const MessageActionsSheet: React.FC<Props> = ({
  visible,
  onClose,
  myReactions,
  onToggleReaction,
  onZap,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  // Hardware back closes the sheet (Android) without bubbling up to the
  // navigator and exiting the conversation. Mirror QrSheet / FeedbackSheet.
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

  return (
    <BottomSheetModal
      ref={sheetRef}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>React</Text>
        <View style={styles.emojiRow} testID="message-actions-emoji-row">
          {QUICK_REACTIONS.map((emoji) => {
            const myReactionId = myReactions[emoji] ?? null;
            const active = myReactionId !== null;
            return (
              <TouchableOpacity
                key={emoji}
                style={[styles.emojiButton, active && styles.emojiButtonActive]}
                onPress={() => onToggleReaction(emoji, myReactionId)}
                accessibilityLabel={`React with ${emoji}`}
                accessibilityState={{ selected: active }}
                testID={`message-actions-emoji-${emoji}`}
              >
                <Text style={styles.emojiText}>{emoji}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {onZap ? (
          <TouchableOpacity
            style={styles.zapButton}
            onPress={onZap}
            accessibilityLabel="Send a zap for this message"
            testID="message-actions-zap"
          >
            <Zap size={18} color={colors.white} fill={colors.white} />
            <Text style={styles.zapButtonText}>Zap this message</Text>
          </TouchableOpacity>
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
    },
    handleIndicator: {
      backgroundColor: colors.divider,
    },
    content: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 24,
      gap: 16,
    },
    title: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    emojiRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      gap: 8,
    },
    emojiButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      // Border keeps the button visually anchored against pink/blue
      // backgrounds; the active state swaps the border to brandPink so
      // "I've already reacted with this" reads at a glance.
      borderWidth: 2,
      borderColor: 'transparent',
    },
    emojiButtonActive: {
      borderColor: colors.brandPink,
      backgroundColor: colors.brandPink + '22',
    },
    emojiText: {
      fontSize: 24,
    },
    zapButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: colors.brandPink,
    },
    zapButtonText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.white,
    },
  });

export default MessageActionsSheet;
