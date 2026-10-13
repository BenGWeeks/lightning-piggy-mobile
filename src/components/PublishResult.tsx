import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createRelayDetailsScreenStyles } from '../styles/RelayDetailsScreen.styles';
import type { RelayPublishResult } from '../services/nostrRelayLists';
import { relayPublishSummary } from '../utils/relayPublishSummary';
import { relayDisplayName } from '../utils/relayDetails';

export default function PublishResult({
  results,
  ownRelays,
}: {
  results: RelayPublishResult[];
  ownRelays: string[];
}) {
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createRelayDetailsScreenStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const summary = relayPublishSummary(results, ownRelays);
  const outcome = (r: RelayPublishResult) =>
    r.ok
      ? t('publishResult.accepted')
      : r.skipped === 'kind'
        ? t('publishResult.kindSkipped')
        : r.skipped === 'unhealthy' || /connection failure|timed out/i.test(r.message ?? '')
          ? t('publishResult.unreachable')
          : (r.message ?? t('publishResult.failed'));
  return (
    <View style={styles.card} testID="relay-publish-result">
      <Text style={styles.value}>
        {t('publishResult.summary', { sent: summary.sent, shared: summary.shared })}
      </Text>
      {summary.skipped.map((r) => (
        <Text key={r.url} style={styles.value}>
          {t('publishResult.skipped', { host: relayDisplayName(r.url), reason: outcome(r) })}
        </Text>
      ))}
      {summary.problems.map((r) => (
        <Text key={r.url} style={styles.value}>
          {t('publishResult.problem', { host: relayDisplayName(r.url), reason: outcome(r) })}
        </Text>
      ))}
      <TouchableOpacity
        testID="relay-publish-details"
        accessibilityRole="button"
        accessibilityLabel={t('publishResult.details')}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
      >
        <Text style={styles.heading}>
          {t('publishResult.details')} {open ? '⌃' : '⌄'}
        </Text>
      </TouchableOpacity>
      {open &&
        results.map((r) => (
          <Text key={r.url} style={styles.value}>
            {r.url}: {outcome(r)}
          </Text>
        ))}
    </View>
  );
}
