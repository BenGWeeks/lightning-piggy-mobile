import { StyleSheet } from 'react-native';
import type { Palette } from '../styles/palettes';

// Styles for ConversationScreen — extracted to its own module to keep the
// screen file under the #703 size cap. Themed via the active Palette.
export type ConversationStyles = ReturnType<typeof createStyles>;

export const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      gap: 10,
    },
    backButton: {
      padding: 4,
    },
    headerPeer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    headerAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.background,
    },
    headerAvatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerName: {
      flex: 1,
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
    },
    listContent: {
      paddingHorizontal: 12,
      // Inverted list: paddingTop becomes the *visual-bottom* padding.
      // The composer (rendered inside KeyboardStickyView below) is a
      // flex sibling, so the FlatList's bottom edge already ends where
      // the composer's top begins — we don't need to clear the
      // composer's height here, just a small breathing gap so the
      // newest bubble doesn't visually hug the composer's top border.
      // ConversationScreen overrides this inline (16 dp) when the
      // attach panel is open. paddingBottom (= visual-top) keeps a
      // small breathing gap above the day-header row.
      paddingTop: 8,
      paddingBottom: 12,
      gap: 6,
      flexGrow: 1,
    },
    bubbleRow: {
      flexDirection: 'row',
      marginVertical: 2,
    },
    bubbleRowLeft: { justifyContent: 'flex-start' },
    bubbleRowRight: { justifyContent: 'flex-end' },
    dayHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: 16,
      paddingBottom: 6,
      paddingHorizontal: 16,
      gap: 12,
    },
    // Wrapper is a centered lane hovering above the composer; the FAB
    // sits inside it so we can horizontally centre it without needing
    // to know the FAB's width. `pointerEvents="box-none"` lets taps
    // outside the button pass through to the message list below.
    scrollToBottomWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      // Lifts the FAB clear of the ~60 px composer by a comfortable gap
      // so it doesn't visually crowd the message input.
      bottom: 92,
      alignItems: 'center',
    },
    scrollToBottomFab: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.brandPink,
      // White ring keeps the FAB visible when it overlaps a pink bubble
      // — otherwise the pink-on-pink blends into an invisible blob.
      borderWidth: 2,
      borderColor: colors.white,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 4,
    },
    dayHeaderRule: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
    },
    dayHeaderText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    // Bubble + per-message-type styles moved to MessageBubble.
    // bubbleTime / bubbleTimeMe stay here because the inline zap
    // renderer (1:1-only Item kind) still uses them for its time slug.
    bubbleTime: {
      fontSize: 10,
      color: colors.textSupplementary,
      marginTop: 4,
      alignSelf: 'flex-end',
    },
    bubbleTimeMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    zapRow: {
      flexDirection: 'row',
      marginVertical: 4,
    },
    zapRowLeft: { justifyContent: 'flex-start' },
    zapRowRight: { justifyContent: 'flex-end' },
    zapCard: {
      flexDirection: 'row',
      alignItems: 'center',
      maxWidth: '85%',
      minWidth: 240,
      paddingTop: 12,
      paddingBottom: 4,
      paddingHorizontal: 14,
      borderRadius: 14,
      borderWidth: 1,
      gap: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    zapCardMe: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    zapCardThem: {
      backgroundColor: colors.surface,
      borderColor: colors.zapYellow,
    },
    zapCardIconBadge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    zapCardIconBadgeMe: {
      backgroundColor: colors.white,
    },
    zapCardIconBadgeThem: {
      backgroundColor: colors.zapYellow,
    },
    zapCardBody: {
      flex: 1,
    },
    zapCardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    zapCardLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    zapCardLabelMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    zapCardTime: {
      fontSize: 10,
      color: colors.textSupplementary,
    },
    zapCardTimeMe: {
      color: 'rgba(255,255,255,0.85)',
    },
    zapCardAmount: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      marginTop: 2,
    },
    zapCardAmountMe: {
      color: colors.white,
    },
    zapCardComment: {
      fontSize: 14,
      color: colors.textBody,
      marginTop: 4,
    },
    zapCardCommentMe: {
      color: colors.white,
    },
    // composer + composerInput + composerSendButton + composerAttachButton
    // moved to ConversationComposer (#251) — kept in sync with the group
    // screen via that shared component.
    // gifCard / gifImage / gifTime / locationCard / locationMap /
    // locationBody / locationLabel / locationCoords / locationAccuracy /
    // imageBubble + bg / time variants moved to MessageBubble. The
    // fullscreen-modal styles below are still used by the Modal that
    // expands a tapped GIF, which lives at the screen level.
    fullscreenBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.92)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    fullscreenImage: {
      width: '100%',
      height: '100%',
    },
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    loadingText: {
      color: colors.textSupplementary,
      fontSize: 14,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 40,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 6,
    },
    emptySubtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
    },
  });
