import { emitSykaEvent } from '@/lib/realtimeBus';
import { getUnreadChatCount, loadMyThreads } from '@/services/chat.service';

type ReconcileScope = 'user';

let inFlightUser: Promise<void> | null = null;

/**
 * Reconcile durable chat state after a Realtime reconnect.
 * Realtime is a change signal, so this is deliberately scoped to chat threads
 * and unread state instead of rehydrating the entire application.
 */
export async function reconcileAfterRealtimeReconnect(scope: ReconcileScope, userId: string): Promise<void> {
  if (scope !== 'user' || !userId) return;
  if (inFlightUser) return inFlightUser;

  inFlightUser = (async () => {
    try {
      await Promise.all([
        loadMyThreads(true),
        getUnreadChatCount(true),
      ]);
      emitSykaEvent({ type: 'chat-reconciled', userId });
    } catch (error) {
      console.warn('[SykaBelajar] chat reconnect reconciliation failed:', error);
    }
  })();

  try {
    await inFlightUser;
  } finally {
    inFlightUser = null;
  }
}
