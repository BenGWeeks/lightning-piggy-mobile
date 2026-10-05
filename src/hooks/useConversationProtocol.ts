import { DEFAULT_DM_PROTOCOL, type DmProtocol } from '../utils/dmProtocol';

/** The route identifies the thread; messages never change its protocol. */
export function useConversationProtocol(routeProtocol: DmProtocol | undefined): DmProtocol {
  return routeProtocol ?? DEFAULT_DM_PROTOCOL;
}
