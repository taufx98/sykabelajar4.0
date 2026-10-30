import type { ChatMessage } from '@/services/chat.service';
import { getPersistentCache, setPersistentCache } from '@/lib/persistentCache';

export interface ChatMessageCache {
  messages: ChatMessage[];
  hasOlder: boolean;
  lastSyncedAt: number;
}

interface StoredChatMessageCache extends ChatMessageCache {
  key: string;
  userId: string;
  threadId: string;
  updatedAt: number;
}

const DATABASE_NAME = 'sykabelajar-chat-history';
const DATABASE_VERSION = 1;
const STORE_NAME = 'threadMessages';
const FALLBACK_TTL_MS = 365 * 24 * 60 * 60 * 1000;

let databasePromise: Promise<IDBDatabase | null> | null = null;

function cacheKey(userId: string, threadId: string): string {
  return `${userId}:${threadId}`;
}

function fallbackKey(userId: string, threadId: string): string {
  return `chat.messages.${userId}.${threadId}`;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ChatMessage>;
  return typeof item.id === 'string'
    && item.id.length > 0
    && typeof item.thread_id === 'string'
    && item.thread_id.length > 0
    && typeof item.sender_id === 'string'
    && item.sender_id.length > 0
    && typeof item.body === 'string'
    && typeof item.created_at === 'string'
    && item.created_at.length > 0;
}

function normalizeCache(value: unknown): ChatMessageCache | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<StoredChatMessageCache>;
  if (!Array.isArray(item.messages)) return null;
  return {
    messages: item.messages.filter(isChatMessage).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    hasOlder: item.hasOlder !== false,
    lastSyncedAt: typeof item.lastSyncedAt === 'number' ? item.lastSyncedAt : 0,
  };
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        databasePromise = null;
        resolve(null);
      };
      request.onblocked = () => {
        databasePromise = null;
        resolve(null);
      };
    } catch {
      databasePromise = null;
      resolve(null);
    }
  });

  return databasePromise;
}

function readFallback(userId: string, threadId: string): ChatMessageCache | null {
  return normalizeCache(getPersistentCache<StoredChatMessageCache>(fallbackKey(userId, threadId))?.data);
}

function writeFallback(
  userId: string,
  threadId: string,
  incoming: ChatMessage[],
  options: { hasOlder?: boolean; lastSyncedAt?: number } = {},
): ChatMessageCache {
  const existing = readFallback(userId, threadId);
  const byId = new Map<string, ChatMessage>();
  for (const message of existing?.messages ?? []) byId.set(message.id, message);
  for (const message of incoming.filter(isChatMessage)) byId.set(message.id, message);

  const result: ChatMessageCache = {
    messages: [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    hasOlder: existing?.hasOlder === false ? false : (options.hasOlder ?? existing?.hasOlder ?? true),
    lastSyncedAt: options.lastSyncedAt ?? existing?.lastSyncedAt ?? 0,
  };
  setPersistentCache(fallbackKey(userId, threadId), {
    ...result,
    key: cacheKey(userId, threadId),
    userId,
    threadId,
    updatedAt: Date.now(),
  }, { ttlMs: FALLBACK_TTL_MS, version: 1 });
  return result;
}

export async function readChatMessageCache(userId: string, threadId: string): Promise<ChatMessageCache | null> {
  if (!userId || !threadId) return null;
  const database = await openDatabase();
  if (!database) return readFallback(userId, threadId);

  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(cacheKey(userId, threadId));
      let result: ChatMessageCache | null = null;
      request.onsuccess = () => {
        result = normalizeCache(request.result);
      };
      transaction.oncomplete = () => resolve(result ?? readFallback(userId, threadId));
      transaction.onerror = () => resolve(readFallback(userId, threadId));
      transaction.onabort = () => resolve(readFallback(userId, threadId));
    } catch {
      resolve(readFallback(userId, threadId));
    }
  });
}

/**
 * Merge downloaded pages into one per-user/per-thread IndexedDB record.
 * The cache is append/merge-only so older pages are never discarded as the
 * conversation grows. Metadata is updated independently from message pages.
 */
export async function mergeChatMessageCache(
  userId: string,
  threadId: string,
  incoming: ChatMessage[],
  options: { hasOlder?: boolean; lastSyncedAt?: number } = {},
): Promise<ChatMessageCache> {
  if (!userId || !threadId) {
    return { messages: incoming.filter(isChatMessage), hasOlder: options.hasOlder ?? true, lastSyncedAt: options.lastSyncedAt ?? 0 };
  }

  const database = await openDatabase();
  if (!database) return writeFallback(userId, threadId, incoming, options);

  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(cacheKey(userId, threadId));
      let result: ChatMessageCache | null = null;
      request.onsuccess = () => {
        const existing = normalizeCache(request.result);
        const byId = new Map<string, ChatMessage>();
        for (const message of existing?.messages ?? []) byId.set(message.id, message);
        for (const message of incoming.filter(isChatMessage)) byId.set(message.id, message);

        result = {
          messages: [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)),
          hasOlder: existing?.hasOlder === false ? false : (options.hasOlder ?? existing?.hasOlder ?? true),
          lastSyncedAt: options.lastSyncedAt ?? existing?.lastSyncedAt ?? 0,
        };
        const record: StoredChatMessageCache = {
          ...result,
          key: cacheKey(userId, threadId),
          userId,
          threadId,
          updatedAt: Date.now(),
        };
        store.put(record);
      };
      transaction.oncomplete = () => resolve(result ?? writeFallback(userId, threadId, incoming, options));
      transaction.onerror = () => resolve(writeFallback(userId, threadId, incoming, options));
      transaction.onabort = () => resolve(writeFallback(userId, threadId, incoming, options));
    } catch {
      resolve(writeFallback(userId, threadId, incoming, options));
    }
  });
}
