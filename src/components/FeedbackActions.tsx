import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ellipsis, Pencil, Trash2 } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createFeedbackActionsStyles } from '../styles/FeedbackActions.styles';

/** Which feedback the actions belong to — sets the testID prefix. */
export type FeedbackKind = 'comment' | 'review';

/**
 * The "⋯" button on your own Market comment / review (#1272). testID
 * `<kind>-actions-<id>` (e.g. `comment-actions-<id>`).
 */
export const FeedbackActionsButton: React.FC<{
  kind: FeedbackKind;
  id: string;
  open: boolean;
  onToggle: () => void;
}> = ({ kind, id, open, onToggle }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createFeedbackActionsStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={styles.button}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={t(`market.feedbackActions.${kind}Actions`)}
      accessibilityState={{ expanded: open }}
      hitSlop={8}
      testID={`${kind}-actions-${id}`}
    >
      <Ellipsis size={18} color={colors.textSupplementary} />
    </TouchableOpacity>
  );
};

/** The inline Edit / Delete chips (testIDs `<kind>-edit`, `<kind>-delete`). */
export const FeedbackActionsRow: React.FC<{
  kind: FeedbackKind;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ kind, onEdit, onDelete }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createFeedbackActionsStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.chip}
        onPress={onEdit}
        accessibilityRole="button"
        testID={`${kind}-edit`}
      >
        <Pencil size={14} color={colors.brandPink} />
        <Text style={styles.chipText}>{t('market.feedbackActions.edit')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.chip}
        onPress={onDelete}
        accessibilityRole="button"
        testID={`${kind}-delete`}
      >
        <Trash2 size={14} color={colors.red} />
        <Text style={[styles.chipText, styles.chipDanger]}>
          {t('market.feedbackActions.delete')}
        </Text>
      </TouchableOpacity>
    </View>
  );
};
