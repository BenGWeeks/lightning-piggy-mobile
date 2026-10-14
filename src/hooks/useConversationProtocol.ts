import { DEFAULT_DM_PROTOCOL, type DmProtocol } from '../utils/dmProtocol';

/** The route identifies the thread; messages never change its protocol. The
 * param is required on navigate; the fallback only covers navigation state
 * persisted by builds from before it was. */
export function useConversationProtocol(routeProtocol: DmProtocol | undefined): DmProtocol {
  return routeProtocol ?? DEFAULT_DM_PROTOCOL;
}
