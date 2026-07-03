import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

// Styles for GroupConversationScreen — own module per the src/styles/<Name>.styles.ts
// convention (and to keep the screen under the #703 size cap). Themed via Palette.
export const createGroupConversationScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.brandPink,
    },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 40,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.9)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    titleTouch: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexShrink: 1,
    },
    title: {
      color: colors.white,
      fontSize: 22,
      fontWeight: '700',
      flexShrink: 1,
    },
    memberCount: {
      color: 'rgba(255,255,255,0.8)',
      fontSize: 13,
      fontWeight: '500',
      marginTop: 8,
      marginLeft: 48,
    },
    actionButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.2)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    deleteIconButton: {
      backgroundColor: 'rgba(0,0,0,0.15)',
    },
    content: {
      flex: 1,
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      marginTop: -24,
      overflow: 'hidden',
    },
    messagesList: {
      paddingVertical: 12,
      paddingHorizontal: 12,
      gap: 6,
      flexGrow: 1,
    },
    // Bubble + per-message-type styles moved to src/components/MessageBubble
    // — both 1:1 and group screens render the same bubble component now.
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
    // composer + input + attachButton + sendButton + sendButtonDisabled
    // moved to ConversationComposer (#251) — kept in sync with the 1:1
    // screen via that shared component.
    emptyState: {
      padding: 40,
      alignItems: 'center',
      gap: 8,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
    },
    emptySubtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
    },
  });
