import React, { useCallback, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Trash2 } from 'lucide-react-native';
import { Alert } from './BrandedAlert';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

/**
 * Width the right-action panel snaps to once the swipe is complete.
 * Wide enough for the icon + "Delete" / "Hide" label without crowding
 * the bubble when the row is half-revealed.
 */
const ACTION_WIDTH = 88;

interface Props {
  /** Stable id for the underlying message. Used as the testID suffix on
   *  the swipe action so Maestro can target it deterministically. */
  messageId: string;
  /** Outgoing → "Delete" copy + destructive confirm. Incoming → "Hide"
   *  to set expectations: the issue body explicitly calls out that we
   *  can't unsend a message we received from someone else. */
  fromMe: boolean;
  /** Display name of the peer (1:1) or sender (group). Used in the
   *  confirm dialog body so users know what they're about to remove. */
  peerLabel?: string;
  /** Called when the user confirms via BrandedAlert. The host owns the
   *  storage call + local state update. */
  onConfirmDelete: () => void;
  children: React.ReactNode;
}

/**
 * Swipeable wrapper around a `MessageBubble`. Swipe-left to reveal a
 * full-height Delete (outgoing) / Hide (incoming) button; tap raises a
 * BrandedAlert confirmation; on confirm the host removes the message
 * from the local cache (#128).
 *
 * Uses `react-native-gesture-handler/ReanimatedSwipeable` (the modern
 * Reanimated-backed implementation) — the legacy `Swipeable` is
 * deprecated in this gesture-handler version.
 */
const MessageRow: React.FC<Props> = ({
  messageId,
  fromMe,
  peerLabel,
  onConfirmDelete,
  children,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Hold the swipeable so the action button can close the row before
  // the BrandedAlert pops — without this the row stays open behind the
  // alert backdrop and looks visually wrong while the user is still
  // deciding whether to confirm.
  const swipeRef = useRef<SwipeableMethods | null>(null);

  const actionLabel = fromMe ? 'Delete' : 'Hide';
  const dialogTitle = fromMe ? 'Delete message?' : 'Hide message?';
  const dialogBody = fromMe
    ? `Remove this message from your device. ${peerLabel ?? 'The other party'} will keep their copy — this only deletes your local view.`
    : `Hide this message from your device. The original sender keeps their copy — this only removes it from your view.`;

  const handleActionPress = useCallback(() => {
    swipeRef.current?.close();
    Alert.alert(
      dialogTitle,
      dialogBody,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: actionLabel, style: 'destructive', onPress: onConfirmDelete },
      ],
      { cancelable: true },
    );
  }, [actionLabel, dialogBody, dialogTitle, onConfirmDelete]);

  // Memoise the renderRightActions callback so the Swipeable doesn't
  // re-mount its action panel on every parent re-render (the FlatList
  // re-creates this row's props when `sharedProfiles` updates, which
  // happens every time a kind-0 lookup resolves — no need to thrash
  // the action panel for each one).
  const renderRightActions = useCallback(
    () => (
      <View style={styles.actionContainer}>
        <Pressable
          onPress={handleActionPress}
          style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel} message`}
          testID={`message-swipe-delete-${messageId}`}
        >
          <Trash2 size={20} color={colors.white} strokeWidth={2.2} />
          <Text style={styles.actionLabel}>{actionLabel}</Text>
        </Pressable>
      </View>
    ),
    [actionLabel, colors.white, handleActionPress, messageId, styles],
  );

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRightActions}
      // 36 px past the snap point feels like a deliberate swipe rather
      // than an accidental scroll-deflection. Empirically chat threads
      // get a lot of vertical scroll-touches that drift slightly to the
      // left; the default 10 px threshold occasionally caught those and
      // half-opened the panel, which read as flicker.
      dragOffsetFromRightEdge={36}
      friction={2}
      // Right-side panel only — the issue specifies swipe-LEFT (i.e. drag
      // the bubble to the left to reveal an action on the right). Leaving
      // the left action undefined disables left-swipe entirely.
      overshootRight={false}
      // testID surfaces the row to Maestro so a flow can find a specific
      // message bubble before performing the swipe.
      testID={`message-row-${messageId}`}
      containerStyle={styles.container}
    >
      {children}
    </Swipeable>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      // Match MessageBubble's bubbleRow vertical spacing so the swipeable
      // doesn't introduce extra gaps between bubbles. Without this the
      // wrapper's default 0 marginVertical creates visibly tighter
      // groupings than an unwrapped bubble.
      marginVertical: 0,
    },
    actionContainer: {
      width: ACTION_WIDTH,
      // The action panel renders behind the bubble and is revealed as the
      // bubble translates. Stretch to fill the row height so the button
      // covers the full bubble vertically (WhatsApp / iMessage feel).
      flexDirection: 'row',
      alignItems: 'stretch',
      justifyContent: 'flex-end',
    },
    actionButton: {
      flex: 1,
      backgroundColor: colors.red,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: 8,
    },
    actionButtonPressed: {
      opacity: 0.85,
    },
    actionLabel: {
      color: colors.white,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.4,
    },
  });

export default MessageRow;
