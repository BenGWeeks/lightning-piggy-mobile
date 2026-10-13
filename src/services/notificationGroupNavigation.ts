import {
  messageNotificationRoute,
  type MessageNotificationRoute,
  type NotificationGroup,
  type NotificationRoutingData,
} from '../utils/notificationRouting';

interface RoutingDependencies {
  getActivePubkey: () => string | null;
  getGroup: (id: string) => NotificationGroup | undefined;
  navigate: (route: MessageNotificationRoute) => void;
  currentRoute: () => string | undefined;
  subscribeState: (report: () => void) => () => void;
  shouldStop: () => boolean;
}

/** Every caller gets bounded hydration retries, including history and resolved pushes. */
export function routeNotificationMessage(
  data: NotificationRoutingData,
  deps: RoutingDependencies,
): true {
  const groupId = data.groupId ?? data.marmotGroupId;
  const needsGroup =
    groupId?.startsWith('marmot:') && (!data.conversationPubkey || data.threadKind === 'group');
  const group = groupId ? deps.getGroup(groupId) : undefined;
  if (!needsGroup || group) {
    deps.navigate(messageNotificationRoute(data, deps.getActivePubkey(), group));
    return true;
  }

  // Show a useful surface immediately; never leave an unavailable alert inert.
  deps.navigate({ screen: 'Messages' });
  const owner = deps.getActivePubkey();
  const deadline = Date.now() + 10_000;
  let reached = false;
  let left = false;
  const report = () => {
    if (deps.currentRoute() === 'Messages') reached = true;
    else if (reached) left = true;
  };
  report();
  const unsubscribe = deps.subscribeState(report);
  const retry = () => {
    if (left || deps.shouldStop() || deps.getActivePubkey() !== owner) {
      unsubscribe();
      return;
    }
    const hydrated = deps.getGroup(groupId!);
    if (hydrated) {
      unsubscribe();
      deps.navigate(messageNotificationRoute(data, deps.getActivePubkey(), hydrated));
    } else if (Date.now() >= deadline) {
      unsubscribe();
    } else {
      setTimeout(retry, 100);
    }
  };
  setTimeout(retry, 100);
  return true;
}
