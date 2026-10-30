import type { ChatMessage } from '@/services/chat.service';
import { getPersistentCache, setPersistentCache } from '@/lib/persistentCache';

export interface ChatMessageCache {
  messages: ChatMessage[];
  hasOlder: boolean;
  hasCachedOlder: boolean;
  oldestCachedAt: string | null;
  lastSyncedAt: number;
}

interface StoredMessage extends ChatMessage {
  key: string;
  userId: string;
  threadId: string;
}

interface StoredThreadMeta {
  key: string;
  userId: string;
  threadId: string;
  hasOlder: boolean;
  oldestCachedAt: string | null;
  lastSyncedAt: number;
  updatedAt: number;
}

interface FallbackCache {
  messages: ChatMessage[];
  hasOlder: boolean;
  oldestCachedAt: string | null;
  lastSyncedAt: number;
}

const DATABASE_NAME = 'sykabelajar-chat-history';
const DATABASE_VERSION = 2;
const MESSAGE_STORE = 'messages';
const THREAD_META_STORE = 'threadMeta';
const MESSAGE_THREAD_INDEX = 'byThreadAndCreatedAt';
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

function toChatMessage(value: StoredMessage): ChatMessage {
  return {
    id: value.id,
    thread_id: value.thread_id,
    sender_id: value.sender_id,
    body: value.body,
    created_at: value.created_at,
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
        let messageStore: IDBObjectStore;
        if (!database.objectStoreNames.contains(MESSAGE_STORE)) {
          messageStore = database.createObjectStore(MESSAGE_STORE, { keyPath: 'key' });
        } else {
          messageStore = request.transaction!.objectStore(MESSAGE_STORE);
        }
        if (!messageStore.indexNames.contains(MESSAGE_THREAD_INDEX)) {
          messageStore.createIndex(MESSAGE_THREAD_INDEX, ['userId', 'threadId', 'created_at', 'id'], { unique: false });
        }
        if (!database.objectStoreNames.contains(THREAD_META_STORE)) {
          database.createObjectStore(THREAD_META_STORE, { keyPath: 'key' });
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

function readFallback(userId: string, threadId: string): FallbackCache | null {
  const data = getPersistentCache<FallbackCache>(fallbackKey(userId, threadId))?.data;
  if (!data || !Array.isArray(data.messages)) return null;
  return {
    messages: data.messages.filter(isChatMessage).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    hasOlder: data.hasOlder !== false,
    oldestCachedAt: typeof data.oldestCachedAt === 'string' ? data.oldestCachedAt : null,
    lastSyncedAt: typeof data.lastSyncedAt === 'number' ? data.lastSyncedAt : 0,
  };
}

function writeFallback(
  userId: string,
  threadId: string,
  incoming: ChatMessage[],
  options: { hasOlder?: boolean; lastSyncedAt?: number } = {},
): FallbackCache {
  const existing = readFallback(userId, threadId);
  const byId = new Map<string, ChatMessage>();
  for (const message of existing?.messages ?? []) byId.set(message.id, message);
  for (const message of incoming.filter(isChatMessage)) byId.set(message.id, message);
  const messages = [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const timestamps = messages.map(message => message.created_at);
  const oldestCachedAt = timestamps.length ? timestamps[0] : existing?.oldestCachedAt ?? null;
  const result: FallbackCache = {
    messages,
    hasOlder: existing?.hasOlder === false ? false : (options.hasOlder ?? existing?.hasOlder ?? true),
    oldestCachedAt,
    lastSyncedAt: options.lastSyncedAt ?? existing?.lastSyncedAt ?? 0,
  };
  setPersistentCache(fallbackKey(userId, threadId), result, { ttlMs: FALLBACK_TTL_MS, version: 2 });
  return result;
}

function readMeta(database: IDBDatabase, userId: string, threadId: string): Promise<StoredThreadMeta | null> {
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(THREAD_META_STORE, 'readonly');
      const request = transaction.objectStore(THREAD_META_STORE).get(cacheKey(userId, threadId));
      let result: StoredThreadMeta | null = null;
      request.onsuccess = () => { result = (request.result as StoredThreadMeta | undefined) ?? null; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function readDatabasePage(
  database: IDBDatabase,
  userId: string,
  threadId: string,
  before: string | null,
  limit: number,
): Promise<ChatMessage[]> {
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(MESSAGE_STORE, 'readonly');
      const index = transaction.objectStore(MESSAGE_STORE).index(MESSAGE_THREAD_INDEX);
      const lower: IDBValidKey = [userId, threadId, '', ''];
      const upper: IDBValidKey = before
        ? [userId, threadId, before, '']
        : [userId, threadId, '9999-12-31T23:59:59.999Z', '~'];
      const range = IDBKeyRange.bound(lower, upper, false, !!before);
      const request = index.openCursor(range, 'prev');
      const rows: ChatMessage[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || rows.length >= limit) return;
        rows.push(toChatMessage(cursor.value as StoredMessage));
        cursor.continue();
      };
      transaction.oncomplete = () => resolve(rows.reverse());
      transaction.onerror = () => resolve([]);
      transaction.onabort = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

function fallbackPage(cache: FallbackCache | null, before: string | null, limit: number): ChatMessage[] {
  if (!cache) return [];
  const eligible = before
    ? cache.messages.filter(message => message.created_at < before)
    : cache.messages;
  return eligible.slice(-limit);
}

export async function readChatMessageCache(
  userId: string,
  threadId: string,
  limit = 20,
): Promise<ChatMessageCache | null> {
  if (!userId || !threadId) return null;
  const database = await openDatabase();
  if (!database) {
    const fallback = readFallback(userId, threadId);
    if (!fallback) return null;
    const messages = fallback.messages.slice(-limit);
    const oldestCachedAt = fallback.oldestCachedAt ?? fallback.messages[0]?.created_at ?? null;
    return {
      messages,
      hasOlder: fallback.hasOlder,
      hasCachedOlder: !!oldestCachedAt && !!messages[0] && oldestCachedAt < messages[0].created_at,
      oldestCachedAt,
      lastSyncedAt: fallback.lastSyncedAt,
    };
  }

  const [messages, meta] = await Promise.all([
    readDatabasePage(database, userId, threadId, null, limit),
    readMeta(database, userId, threadId),
  ]);
  if (!messages.length && !meta) {
    const fallback = readFallback(userId, threadId);
    if (!fallback) return null;
    const latest = fallback.messages.slice(-limit);
    const oldestCachedAt = fallback.oldestCachedAt ?? fallback.messages[0]?.created_at ?? null;
    return {
      messages: latest,
      hasOlder: fallback.hasOlder,
      hasCachedOlder: !!oldestCachedAt && !!latest[0] && oldestCachedAt < latest[0].created_at,
      oldestCachedAt,
      lastSyncedAt: fallback.lastSyncedAt,
    };
  }
  const oldestCachedAt = meta?.oldestCachedAt ?? messages[0]?.created_at ?? null;
  return {
    messages,
    hasOlder: meta?.hasOlder !== false,
    hasCachedOlder: !!oldestCachedAt && !!messages[0] && oldestCachedAt < messages[0].created_at,
    oldestCachedAt,
    lastSyncedAt: meta?.lastSyncedAt ?? 0,
  };
}

export async function readOlderChatMessageCache(
  userId: string,
  threadId: string,
  before: string,
  limit = 50,
): Promise<ChatMessage[]> {
  if (!userId || !threadId || !before) return [];
  const database = await openDatabase();
  if (!database) return fallbackPage(readFallback(userId, threadId), before, limit);
  const rows = await readDatabasePage(database, userId, threadId, before, limit);
  return rows.length ? rows : fallbackPage(readFallback(userId, threadId), before, limit);
}

/**
 * Store only new page rows as individual IndexedDB records. A separate metadata
 * row tracks the oldest cached cursor and whether Supabase has older pages,
 * avoiding a full-history rewrite whenever one more page is downloaded.
 */
export async function mergeChatMessageCache(
  userId: string,
  threadId: string,
  incoming: ChatMessage[],
  options: { hasOlder?: boolean; lastSyncedAt?: number } = {},
): Promise<void> {
  if (!userId || !threadId) return;
  const validRows = incoming.filter(message => isChatMessage(message) && message.thread_id === threadId);
  const database = await openDatabase();
  if (!database) {
    writeFallback(userId, threadId, validRows, options);
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction([MESSAGE_STORE, THREAD_META_STORE], 'readwrite');
      const messageStore = transaction.objectStore(MESSAGE_STORE);
      const metaStore = transaction.objectStore(THREAD_META_STORE);
      for (const message of validRows) {
        const stored: StoredMessage = {
          ...message,
          key: `${userId}:${threadId}:${message.id}`,
          userId,
          threadId,
        };
        messageStore.put(stored);
      }

      const request = metaStore.get(cacheKey(userId, threadId));
      request.onsuccess = () => {
        const existing = request.result as StoredThreadMeta | undefined;
        const oldestIncoming = validRows.reduce<string | null>(
          (oldest, message) => !oldest || message.created_at < oldest ? message.created_at : oldest,
          null,
        );
        const oldestCachedAt = existing?.oldestCachedAt && oldestIncoming
          ? (existing.oldestCachedAt < oldestIncoming ? existing.oldestCachedAt : oldestIncoming)
          : existing?.oldestCachedAt ?? oldestIncoming;
        const meta: StoredThreadMeta = {
          key: cacheKey(userId, threadId),
          userId,
          threadId,
          hasOlder: existing?.hasOlder === false ? false : (options.hasOlder ?? existing?.hasOlder ?? true),
          oldestCachedAt,
          lastSyncedAt: options.lastSyncedAt ?? existing?.lastSyncedAt ?? 0,
          updatedAt: Date.now(),
        };
        metaStore.put(meta);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        writeFallback(userId, threadId, validRows, options);
        resolve();
      };
      transaction.onabort = () => {
        writeFallback(userId, threadId, validRows, options);
        resolve();
      };
    } catch {
      writeFallback(userId, threadId, validRows, options);
      resolve();
    }
  });
}
