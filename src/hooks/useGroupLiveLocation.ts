import { useCallback, useMemo, useState } from 'react';
import { Alert } from '../components/BrandedAlert';
import { useLiveLocation } from '../contexts/LiveLocationContext';
import { useNostr } from '../contexts/NostrContext';
import { isDeviceNoticeRow, type GroupTimelineRow } from './useGroupTimeline';
import { t } from '../i18n';
import {
  useLiveLocationThread,
  useStableRecord,
  type ThreadLiveMarker,
} from './useConversationLiveLocation';
import { useStartLiveLocationShare } from './useStartLiveLocationShare';

/**
 * Live location in a group chat (#1300). In a Marmot group the Attach →
 * Location tile opens the snapshot-or-live chooser, and a live share goes to
 * the whole group over MLS (everyone sees your marker); NIP-17 groups keep the
 * one-shot snapshot. Also derives the live bubbles' read models from the
 * group's messages. Kept out of GroupConversationScreen (#703 size cap).
 */
export function useGroupLiveLocation(params: {
  groupId: string | null;
  marmotGroupId: string | null;
  groupName: string;
  /** The group's timeline rows (device-notice rows are skipped). */
  messages: GroupTimelineRow[];
  handleShareLocation: () => Promise<void> | void;
  closeAttachPanel: () => void;
}) {
  const { groupId, marmotGroupId, groupName, messages, handleShareLocation, closeAttachPanel } =
    params;
  const { pubkey: myPubkey, isLoggedIn, signerType, relays } = useNostr();
  const { stopShare } = useLiveLocation();
  const [pickerOpen, setPickerOpen] = useState(false);

  const closePicker = useCallback(() => setPickerOpen(false), []);
  const openLocation = useCallback(() => {
    if (!marmotGroupId) return void handleShareLocation();
    closeAttachPanel();
    setPickerOpen(true);
  }, [marmotGroupId, handleShareLocation, closeAttachPanel]);
  const shareSnapshot = useCallback(async () => {
    setPickerOpen(false);
    await handleShareLocation();
  }, [handleShareLocation]);

  const target = useMemo(
    () => ({ kind: 'group' as const, groupId: marmotGroupId ?? '' }),
    [marmotGroupId],
  );
  const shareLive = useStartLiveLocationShare({
    target,
    name: groupName || t('liveLocationTracking.aGroup'),
    closePicker,
  });
  const stopLive = useCallback(
    async (sessionId: string) => {
      const result = await stopShare(sessionId);
      if (!result.ok) Alert.alert(t('conversationScreen.couldNotStopLiveShareTitle'), result.error);
    },
    [stopShare],
  );

  const markers = useMemo<ThreadLiveMarker[]>(() => {
    const out: ThreadLiveMarker[] = [];
    for (const m of messages) {
      if (isDeviceNoticeRow(m) || m.content.kind !== 'liveLocationMarker') continue;
      out.push({
        fromMe: m.senderPubkey === myPubkey,
        sender: m.senderPubkey,
        marker: m.content.marker,
        createdAt: m.createdAt,
      });
    }
    return out;
  }, [messages, myPubkey]);
  const thread = useLiveLocationThread({
    markers: useStableRecord(markers),
    threadKey: marmotGroupId ?? groupId ?? '',
    marmot: !!marmotGroupId,
    isLoggedIn,
    myPubkey,
    signerType,
    relays,
  });

  return { pickerOpen, openLocation, closePicker, shareSnapshot, shareLive, stopLive, ...thread };
}
