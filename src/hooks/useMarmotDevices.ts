// React side of a person's devices in a Marmot chat (#1267). Three hooks, each
// as lazy as its surface allows (CLAUDE.md performance rules):
//   - useMarmotChatDevices: the chat's id + per-person device COUNTS for the
//     header by-line and the members sheet subtitles. Recomputed only when
//     the session reports a membership change (a commit), never per message,
//     and only while the screen is focused.
//   - useMarmotDeviceDetails: the full device list (apps, times, epochs), read
//     only while a sheet that shows it is open; opening it also runs the
//     bounded relay lookup that names unknown apps.
//   - useMarmotDeviceNotices: the alpha-only "joined on N devices" lines,
//     behind the developer switch.

import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import {
  loadDeviceNoticesEnabled,
  subscribeDeviceNoticesEnabled,
} from '../services/deviceNoticesPreference';
import type { DeviceNoticeView, GroupDevices } from '../services/marmotDeviceTracker';
import {
  getMarmotSession,
  MARMOT_GROUP_ID_PREFIX,
  subscribeMarmotSession,
  type MarmotSession,
} from '../services/marmotSession';

/** A Marmot chat: an app group id (`marmot:…`), or the 1:1 with `peer`. */
export interface MarmotChatRef {
  groupId?: string | null;
  peer?: string | null;
}

export interface MarmotChatDevices {
  /** The chat's MLS group id (hex); null if it isn't a loaded Marmot chat. */
  chatId: string | null;
  /** Person (lower-case pubkey) → device count. */
  counts: ReadonlyMap<string, number> | null;
}

const NO_CHAT: MarmotChatDevices & { sig: string } = { chatId: null, counts: null, sig: '' };
const NO_NOTICES: DeviceNoticeView[] = [];

function chatIdFor(session: MarmotSession, ref: MarmotChatRef): string | null {
  const appId = ref.groupId ?? (ref.peer ? session.findDm(ref.peer)?.id : undefined);
  return appId?.startsWith(MARMOT_GROUP_ID_PREFIX)
    ? appId.slice(MARMOT_GROUP_ID_PREFIX.length)
    : null;
}

/** The chat's id and device counts, kept current while the screen is focused. */
export function useMarmotChatDevices(
  ref: MarmotChatRef,
  owner: string | null | undefined,
): MarmotChatDevices {
  const [state, setState] = useState(NO_CHAT);
  const { groupId, peer } = ref;
  useFocusEffect(
    useCallback(() => {
      if (!owner || (!groupId && !peer)) {
        setState(NO_CHAT);
        return;
      }
      let unsubscribeGroups: (() => void) | null = null;
      const update = (session: MarmotSession) => {
        const chatId = chatIdFor(session, { groupId, peer });
        const counts = chatId ? session.devices.counts(chatId) : null;
        const sig = `${chatId}|${counts ? [...counts].join(';') : ''}`;
        // Same counts → same object: no re-render for an unrelated commit.
        setState((prev) => (prev.sig === sig ? prev : { chatId, counts, sig }));
      };
      const unsubscribeSession = subscribeMarmotSession((session) => {
        unsubscribeGroups?.();
        unsubscribeGroups = null;
        if (!session || session.pubkey !== owner) {
          setState(NO_CHAT);
          return;
        }
        update(session);
        unsubscribeGroups = session.subscribe({ onGroupsChanged: () => update(session) });
      });
      return () => {
        unsubscribeSession();
        unsubscribeGroups?.();
      };
    }, [owner, groupId, peer]),
  );
  return state;
}

/**
 * Every device in the chat with its app, key time and epoch — loaded only
 * while `enabled` (the sheet showing it is open). Opening also starts the
 * bounded relay lookup for apps we don't know yet; the list refreshes when
 * it finds any, and on membership changes.
 */
export function useMarmotDeviceDetails(
  chatId: string | null,
  enabled: boolean,
): GroupDevices | null {
  const [devices, setDevices] = useState<{ chatId: string; view: GroupDevices } | null>(null);
  useEffect(() => {
    const session = getMarmotSession();
    if (!enabled || !chatId || !session) return;
    let live = true;
    const load = () => {
      session.devices
        .devices(chatId)
        .then((view) => {
          if (live && view) setDevices({ chatId, view });
        })
        .catch(() => undefined);
    };
    load();
    void session.devices.resolveClients(chatId).catch(() => false);
    const unsubscribeTracker = session.devices.subscribe((id) => {
      if (id === chatId) load();
    });
    const unsubscribeGroups = session.subscribe({ onGroupsChanged: load });
    return () => {
      live = false;
      unsubscribeTracker();
      unsubscribeGroups();
    };
  }, [chatId, enabled]);
  return devices && devices.chatId === chatId ? devices.view : null;
}

/** Whether the "Show device changes in chats" developer switch is on. */
export function useDeviceNoticesEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    void loadDeviceNoticesEnabled().then((v) => {
      if (live) setEnabled(v);
    });
    const unsubscribe = subscribeDeviceNoticesEnabled(setEnabled);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return enabled;
}

/** The chat's alpha-only device notices (empty when the switch is off). */
export function useMarmotDeviceNotices(chatId: string | null): DeviceNoticeView[] {
  const enabled = useDeviceNoticesEnabled();
  const [notices, setNotices] = useState<{ chatId: string; list: DeviceNoticeView[] } | null>(null);
  useFocusEffect(
    useCallback(() => {
      const session = getMarmotSession();
      if (!enabled || !chatId || !session) return;
      let live = true;
      const load = () => {
        session.devices
          .notices(chatId)
          .then((list) => {
            if (live) setNotices({ chatId, list });
          })
          .catch(() => undefined);
      };
      load();
      // Fires only when a commit adds devices or an app name is learnt.
      const unsubscribe = session.devices.subscribe((id) => {
        if (id === chatId) load();
      });
      return () => {
        live = false;
        unsubscribe();
      };
    }, [chatId, enabled]),
  );
  return enabled && notices && notices.chatId === chatId && notices.list.length > 0
    ? notices.list
    : NO_NOTICES;
}
