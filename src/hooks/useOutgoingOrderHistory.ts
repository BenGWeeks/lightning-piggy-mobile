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
 * conversation + our own kind-16 rows) per distinct set of missing ids; the
 * result feeds `buildConversationItems` as the fallback map — in-slice orders
 * still take precedence, and a store failure leaves the request unverified
 * (fail closed), exactly as if the history didn't exist.
 */
export function useOutgoingOrderHistory(
  owner: string | null,
  conversation: string,
  messages: ConversationMessageInput[],
): Amounts {
  // Newline-joined so the effect keys on the SET of ids, not the array identity
  // (`messages` is a fresh array on every delivery-tick settle).
  const key = useMemo(() => orderIdsNeedingHistory(messages).join('\n'), [messages]);
  const [resolved, setResolved] = useState<{ key: string; amounts: Amounts }>({
    key: '',
    amounts: EMPTY,
  });

  useEffect(() => {
    if (!owner || key.length === 0) return;
    let cancelled = false;
    const ids = key.split('\n');
    const wanted = new Set(ids);
    getOutgoingOrderRows(owner, conversation.trim().toLowerCase(), ids)
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
        setResolved({ key, amounts });
      })
      .catch(() => {
        // Store unavailable → the request stays unverified (fail closed).
      });
    return () => {
      cancelled = true;
    };
  }, [owner, conversation, key]);

  return resolved.key === key ? resolved.amounts : EMPTY;
}
