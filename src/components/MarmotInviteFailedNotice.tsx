import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Lock } from 'lucide-react-native';
import { useTranslation } from '../contexts/LocaleContext';
import { formatTime } from '../utils/messageContent';
import type { Palette } from '../styles/palettes';
import { createMarmotInviteFailedNoticeStyles } from '../styles/MarmotInviteFailedNotice.styles';

interface Props {
  id: string;
  createdAt: number;
  /** Who sent the invite; falls back to a neutral "Someone". */
  peerName?: string;
  colors: Palette;
  /** Puts a "please invite me again" message in the composer. */
  onAskAgain?: () => void;
}

/**
 * A Marmot invite (secure chat) from this contact that couldn't be opened on
 * this phone (#1269) — e.g. it was made for an old invitation key. Drawn by
 * us in the 1:1 thread; never sent. Invites that worked show as their own
 * chat instead, so they never reach this notice.
 */
const MarmotInviteFailedNotice: React.FC<Props> = ({
  id,
  createdAt,
  peerName,
  colors,
  onAskAgain,
}) => {
  const t = useTranslation();
  const styles = useMemo(() => createMarmotInviteFailedNoticeStyles(colors), [colors]);
  const name = peerName?.trim() || t('marmotInviteFailed.someone');
  const message = t('marmotInviteFailed.notice', { name });
  return (
    <View style={styles.row}>
      <View
        style={styles.card}
        accessible={!onAskAgain}
        accessibilityLabel={message}
        testID={`marmot-invite-failed-${id}`}
      >
        <Lock size={16} color={colors.textSupplementary} />
        <Text style={styles.text}>{message}</Text>
        {onAskAgain ? (
          <TouchableOpacity
            style={styles.askButton}
            onPress={onAskAgain}
            accessibilityRole="button"
            accessibilityLabel={t('marmotInviteFailed.askAgain')}
            testID={`marmot-invite-failed-ask-${id}`}
          >
            <Text style={styles.askText}>{t('marmotInviteFailed.askAgain')}</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={styles.time}>{formatTime(createdAt)}</Text>
      </View>
    </View>
  );
};

export default React.memo(MarmotInviteFailedNotice);
