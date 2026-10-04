import React, { useMemo } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { CheckCircle, CircleAlert } from 'lucide-react-native';
import { useConnectionTest } from '../utils/useConnectionTest';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createServerConnectionTestStyles } from '../styles/ServerConnectionTest.styles';

export default function ServerConnectionTest({
  inputKey,
  probe,
  disabled = false,
  testID,
  label,
}: {
  inputKey: string;
  probe: (signal: AbortSignal) => Promise<unknown>;
  disabled?: boolean;
  testID: string;
  label: string;
}) {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createServerConnectionTestStyles(colors), [colors]);
  const focused = useIsFocused();
  const { state, run } = useConnectionTest(inputKey, probe, 10000, focused);
  const checking = state.phase === 'checking';
  return (
    <View>
      <TouchableOpacity
        style={styles.button}
        onPress={run}
        disabled={disabled || checking}
        testID={`${testID}-test`}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: disabled || checking, busy: checking }}
      >
        <Text style={styles.buttonText}>
          {t(checking ? 'serverConnection.checking' : 'serverConnection.test')}
        </Text>
      </TouchableOpacity>
      {state.phase !== 'idle' && (
        <View
          style={[
            styles.result,
            state.phase === 'success' && styles.success,
            state.phase === 'error' && styles.error,
          ]}
          testID={`${testID}-${state.phase}`}
          accessibilityLiveRegion="polite"
        >
          {checking && <ActivityIndicator color={colors.brandPink} />}
          {state.phase === 'success' && <CheckCircle size={20} color={colors.greenDark} />}
          {state.phase === 'error' && <CircleAlert size={20} color={colors.red} />}
          <Text
            style={[
              styles.text,
              state.phase === 'success' && styles.successText,
              state.phase === 'error' && styles.errorText,
            ]}
          >
            {t(
              state.phase === 'success'
                ? 'serverConnection.verified'
                : state.phase === 'error'
                  ? state.reason === 'timeout'
                    ? 'serverConnection.timeout'
                    : 'serverConnection.failed'
                  : 'serverConnection.checking',
            )}
          </Text>
        </View>
      )}
    </View>
  );
}
