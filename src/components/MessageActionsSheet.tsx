import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, BackHandler } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { Copy, Plus, Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createMessageActionsSheetStyles } from '../styles/MessageActionsSheet.styles';
import { MORE_REACTIONS, QUICK_REACTIONS } from '../utils/reactions';

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
  /** Copies the message's text. Undefined (row hidden) for non-text
   *  messages — photos, polls, wallet shares. */
  onCopyText?: () => void;
}

const MessageActionsSheet: React.FC<Props> = ({
  visible,
  onClose,
  myReactions,
  onToggleReaction,
  onZap,
  onCopyText,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMessageActionsSheetStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  // The "more emoji" grid starts collapsed each time the sheet opens.
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (visible) {
      setShowMore(false);
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

  const renderEmoji = (emoji: string) => {
    const myReactionId = myReactions[emoji] ?? null;
    const active = myReactionId !== null;
    return (
      <TouchableOpacity
        key={emoji}
        style={[styles.emojiButton, active && styles.emojiButtonActive]}
        onPress={() => onToggleReaction(emoji, myReactionId)}
        accessibilityLabel={
          active
            ? t('messageActionsSheet.removeReaction', { emoji })
            : t('messageActionsSheet.reactWith', { emoji })
        }
        accessibilityState={{ selected: active }}
        testID={`message-actions-emoji-${emoji}`}
      >
        <Text style={styles.emojiText}>{emoji}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>{t('messageActionsSheet.title')}</Text>
        <View style={styles.emojiRow} testID="message-actions-emoji-row">
          {QUICK_REACTIONS.map(renderEmoji)}
          <TouchableOpacity
            style={[styles.emojiButton, showMore && styles.emojiButtonActive]}
            onPress={() => setShowMore((v) => !v)}
            accessibilityLabel={t('messageActionsSheet.moreEmoji')}
            accessibilityState={{ expanded: showMore }}
            testID="message-actions-more-emoji"
          >
            <Plus size={22} color={colors.textHeader} />
          </TouchableOpacity>
        </View>
        {showMore ? (
          <View style={styles.moreEmojiGrid} testID="message-actions-more-emoji-grid">
            {MORE_REACTIONS.map(renderEmoji)}
          </View>
        ) : null}
        {onCopyText ? (
          <TouchableOpacity
            style={styles.copyButton}
            onPress={onCopyText}
            accessibilityLabel={t('messageActionsSheet.copyText')}
            testID="message-actions-copy"
          >
            <Copy size={18} color={colors.textHeader} />
            <Text style={styles.copyButtonText}>{t('messageActionsSheet.copyText')}</Text>
          </TouchableOpacity>
        ) : null}
        {onZap ? (
          <TouchableOpacity
            style={styles.zapButton}
            onPress={onZap}
            accessibilityLabel={t('messageActionsSheet.zapMessageA11y')}
            testID="message-actions-zap"
          >
            <Zap size={18} color={colors.white} fill={colors.white} />
            <Text style={styles.zapButtonText}>{t('messageActionsSheet.zapMessage')}</Text>
          </TouchableOpacity>
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
};

export default MessageActionsSheet;
