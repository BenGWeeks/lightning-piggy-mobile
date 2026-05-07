import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

// Minimal text-only preview card for a friend's kind-1 note. Embedded
// images, mention rendering, replies, reactions, and zaps are deferred
// to follow-up issues (see PR #439 description).
interface Props {
  content: string;
  createdAt: number;
  testID?: string;
}

// Format created_at (unix seconds) as a short relative timestamp.
function formatRelative(createdAtSec: number): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, nowSec - createdAtSec);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / (86400 * 7))}w ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
}

const NotePreview: React.FC<Props> = ({ content, createdAt, testID }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const relative = useMemo(() => formatRelative(createdAt), [createdAt]);

  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.timestamp}>{relative}</Text>
      <Text style={styles.body}>{content}</Text>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    timestamp: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginBottom: 6,
      fontWeight: '500',
    },
    body: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textBody,
    },
  });

export default NotePreview;
