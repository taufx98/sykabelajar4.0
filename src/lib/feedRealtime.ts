import type { FeedPost } from '@/types';
import { liveFeed } from '@/data/live';
import { CACHE_TTL, CACHE_VERSION } from '@/lib/cacheRegistry';
import { getPersistentCache, setPersistentCache } from '@/lib/persistentCache';

function toFeedPost(row: Record<string, unknown>): FeedPost {
  const competitionId = row.competition_id == null ? undefined : String(row.competition_id);
  return {
    id: String(row.id ?? ''),
    userId: String(row.author_user_id ?? ''),
    competitionId,
    competitionSlug: row.competition_slug == null ? undefined : String(row.competition_slug),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    likes: Number(row.likes ?? 0),
    reposts: Number(row.reposts ?? 0),
    image: row.cover_url == null ? undefined : String(row.cover_url),
    type: competitionId ? 'competition' : 'post',
    meta: competitionId ? 'Lomba' : 'Post',
    comments: [],
  };
}

function sortNewest(rows: FeedPost[]) {
  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return rows.slice(0, 50);
}

/**
 * Apply exactly one posts change to the client-side feed snapshot.
 * Realtime is a change signal; the database remains authoritative.
 */
export function applyFeedRealtimeChange(eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) {
  const postId = String(row.id ?? '');
  if (!postId) return;

  const published = String(row.status ?? 'PUBLISHED') === 'PUBLISHED';
  const shouldRemove = eventType === 'DELETE' || !published;
  const next = shouldRemove
    ? liveFeed.filter((post) => post.id !== postId)
    : liveFeed.filter((post) => post.id !== postId).concat(toFeedPost(row));

  liveFeed.splice(0, liveFeed.length, ...sortNewest(next));

  const cached = getPersistentCache<FeedPost[]>('public.feed', CACHE_VERSION)?.data;
  if (cached) {
    const cachedNext = shouldRemove
      ? cached.filter((post) => post.id !== postId)
      : cached.filter((post) => post.id !== postId).concat(toFeedPost(row));
    setPersistentCache('public.feed', sortNewest(cachedNext), {
      ttlMs: CACHE_TTL.feed,
      version: CACHE_VERSION,
    });
  }
}

export function findFeedPost(id: string): FeedPost | undefined {
  return liveFeed.find((post) => post.id === id);
}
