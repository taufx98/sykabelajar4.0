export type SykaRealtimeEvent =
  | { type: 'chat-read'; threadId: string }
  | { type: 'chat-hidden'; threadId: string }
  | { type: 'chat-blocked'; userId: string }
  | { type: 'chat-unblocked'; userId: string }
  | { type: 'chat-unread'; threadId: string }
  | { type: 'chat-message'; message: Record<string, unknown> }
  | { type: 'chat-thread-updated'; thread: Record<string, unknown> }
  | { type: 'follow-updated'; userId: string; status: string }
  | { type: 'profile-updated'; userId: string; fields?: string[] }
  | { type: 'notification-inserted'; notificationId: string; notification?: Record<string, unknown> }
  | { type: 'notification-read'; notificationId: string }
  | { type: 'notification-all-read' }
  | { type: 'order-changed'; order: Record<string, unknown> }
  | { type: 'competition-changed'; competition: Record<string, unknown> }
  | { type: 'banner-changed'; banner: Record<string, unknown> };

const EVENT = 'syka:realtime';

export function emitSykaEvent(event: SykaRealtimeEvent) {
  window.dispatchEvent(new CustomEvent<SykaRealtimeEvent>(EVENT, { detail: event }));
}

export function subscribeSykaEvents(listener: (event: SykaRealtimeEvent) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<SykaRealtimeEvent>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
