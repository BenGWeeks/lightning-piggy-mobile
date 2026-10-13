import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import RelayStatusDot from './RelayStatusDot';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createPublishedRelayListsSectionStyles } from '../styles/PublishedRelayListsSection.styles';
import { relayAccessTag, relayRowHost, relayDisplayName } from '../utils/relayDetails';
import { isPublishableRelayUrl } from '../utils/relayListEvents';

export default React.memo(function RelaySettingsRow({
  url,
  read,
  write,
  status,
  inbox = false,
  testIDPrefix = '',
  onOpen,
}: {
  url: string;
  read?: boolean;
  write?: boolean;
  status?: boolean;
  inbox?: boolean;
  testIDPrefix?: string;
  onOpen: (url: string, kind: 'nip65' | 'inbox') => void;
}) {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createPublishedRelayListsSectionStyles(colors), [colors]);
  const tag = read === undefined || write === undefined ? null : relayAccessTag({ read, write });
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onOpen(url, inbox ? 'inbox' : 'nip65')}
      testID={`${testIDPrefix}${inbox ? 'inbox-' : ''}relay-row-${relayRowHost(url)}`}
      accessibilityRole="button"
      accessibilityLabel={url}
    >
      <RelayStatusDot status={status} />
      <View style={styles.urlColumn}>
        <Text style={styles.url} numberOfLines={2} ellipsizeMode="tail">
          {relayDisplayName(url)}
        </Text>
        {!isPublishableRelayUrl(url) && (
          <Text style={styles.urlWarning}>{t('publishedRelays.notPublishable')}</Text>
        )}
      </View>
      {tag && <Text style={styles.accessTag}>{t(`relayDetails.${tag}`)}</Text>}
      <ChevronRight size={16} color={colors.white} />
    </TouchableOpacity>
  );
});
