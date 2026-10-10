import React, { useMemo } from 'react';
import { View, Text, ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native';
import { Check, Circle, X as XIcon } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createStepChecklistStyles } from '../styles/StepChecklist.styles';

export type ChecklistStepStatus = 'complete' | 'active' | 'pending' | 'failed';

export interface ChecklistStep {
  id: string;
  label: string;
  status: ChecklistStepStatus;
}

interface Props {
  steps: readonly ChecklistStep[];
  /** testID of the list; each row is `${stepTestIDPrefix}${step.id}`. */
  testID: string;
  stepTestIDPrefix: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A ✓ / spinner / ○ / ✗ step list. Shared by the Move sheet's progress view
 * (#62) and the Send overlay's Boltz swap stages (#1179) so both swap
 * directions show their progress the same way.
 */
const StepChecklist: React.FC<Props> = ({ steps, testID, stepTestIDPrefix, style }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStepChecklistStyles(colors), [colors]);
  return (
    <View style={[styles.stepList, style]} testID={testID}>
      {steps.map((s) => (
        <View
          key={s.id}
          style={styles.stepRow}
          testID={`${stepTestIDPrefix}${s.id}`}
          accessible={true}
          accessibilityLabel={`${s.label} ${s.status}`}
        >
          <View style={styles.stepIcon}>
            {s.status === 'complete' ? (
              <Check size={20} color={colors.brandPink} />
            ) : s.status === 'failed' ? (
              <XIcon size={20} color={colors.red} />
            ) : s.status === 'active' ? (
              <ActivityIndicator size="small" color={colors.brandPink} />
            ) : (
              <Circle size={20} color={colors.textSupplementary} />
            )}
          </View>
          <Text
            style={[
              styles.stepLabel,
              s.status === 'pending' && styles.stepLabelPending,
              s.status === 'failed' && styles.stepLabelFailed,
            ]}
          >
            {s.label}
          </Text>
        </View>
      ))}
    </View>
  );
};

export default React.memo(StepChecklist);
