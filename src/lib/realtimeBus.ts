export type SykaRealtimeEvent =
  | { type: 'chat-read'; threadId: string }
  | { type: 'chat-hidden'; threadId: string }
  | { type: 'chat-blocked'; userId: string }
  | { type: 'chat-unblocked'; userId: string }
  | { type: 'chat-unread'; threadId: string }
  | { type: 'follow-updated'; userId: string; status: string }
  | { type: 'profile-updated'; userId: string; fields?: string[] };

const EVENT = 'syka:realtime';

export function emitSykaEvent(event: SykaRealtimeEvent) {
  window.dispatchEvent(new CustomEvent<SykaRealtimeEvent>(EVENT, { detail: event }));
}

export function subscribeSykaEvents(listener: (event: SykaRealtimeEvent) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<SykaRealtimeEvent>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
