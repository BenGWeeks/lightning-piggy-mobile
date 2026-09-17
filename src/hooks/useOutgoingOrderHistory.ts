import { useEffect, useMemo, useState } from 'react';
import { getOutgoingOrderRows } from '../services/dmDb';
import {
  collectApprovedOrderAmounts,
  orderIdsNeedingHistory,
  type ConversationMessageInput,
} from '../utils/conversationItems';

type Amounts = ReadonlyMap<string, number | undefined>;
const EMPTY: Amounts = new Map();

/**
 * Buyer-approved totals for payment requests whose outgoing order is OLDER
 * than the loaded thread slice (DM_CONV_CAP — Copilot review on #948). The
 * conversation loader only reads the newest rows, so a merchant's payment
 * request for a months-old order would otherwise be permanently "amount
 * unverified" and unpayable. One targeted store read (scoped to owner +
 * conversation + our own kind-16 rows) per distinct (owner, conversation,
 * id-set) scope; the result feeds `buildConversationItems` as the fallback
 * map — in-slice orders still take precedence, and a store failure leaves the
 * request unverified (fail closed), exactly as if the history didn't exist.
 *
 * The resolved result is keyed by the FULL scope, never just the id set: a
 * mounted screen whose owner or peer changes must not hand the previous
 * scope's totals to a different conversation's invoice.
 */
export function useOutgoingOrderHistory(
  owner: string | null,
  conversation: string,
  messages: ConversationMessageInput[],
): Amounts {
  const peer = conversation.trim().toLowerCase();
  // Newline-joined so the effect keys on the SET of ids, not the array identity
  // (`messages` is a fresh array on every delivery-tick settle).
  const idsKey = useMemo(() => orderIdsNeedingHistory(messages).join('\n'), [messages]);
  const scope = owner && idsKey.length > 0 ? `${owner}\n${peer}\n${idsKey}` : '';
  const [resolved, setResolved] = useState<{ scope: string; amounts: Amounts }>({
    scope: '',
    amounts: EMPTY,
  });

  useEffect(() => {
    if (!owner || scope.length === 0) return;
    let cancelled = false;
    const ids = idsKey.split('\n');
    const wanted = new Set(ids);
    getOutgoingOrderRows(owner, peer, ids)
      .then((rows) => {
        if (cancelled) return;
        // Same fail-closed rule as the in-slice derivation (conflicting
        // totals → undefined). The LIKE pre-filter is a substring match, so
        // keep only the ids actually asked for.
        const amounts = collectApprovedOrderAmounts(
          rows.map((r) => ({
            id: r.eventId,
            fromMe: r.fromMe,
            text: r.content,
            createdAt: r.createdAt,
            wireKind: r.wireKind,
          })),
        );
        for (const id of [...amounts.keys()]) if (!wanted.has(id)) amounts.delete(id);
        setResolved({ scope, amounts });
      })
      .catch(() => {
        // Store unavailable → the request stays unverified (fail closed).
      });
    return () => {
      cancelled = true;
    };
  }, [owner, peer, idsKey, scope]);

  return resolved.scope === scope ? resolved.amounts : EMPTY;
}
