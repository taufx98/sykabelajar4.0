import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, UserPlus, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/ui/Avatar';

export interface PickedUser {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
}

interface UserPickerProps {
  /** Users already in the org — excluded from search results */
  excludedUserIds?: string[];
  /** Currently selected (pending) users */
  selected: PickedUser[];
  /** Called when selection changes */
  onSelectionChange: (users: PickedUser[]) => void;
  /** Called when the user presses "Add" or Enter with selections */
  onAdd: () => void;
  /** Whether the parent is busy (disables interactions) */
  disabled?: boolean;
  /** Placeholder text */
  placeholder?: string;
}

export function UserPicker({
  excludedUserIds = [],
  selected,
  onSelectionChange,
  onAdd,
  disabled = false,
  placeholder = 'Cari nama atau username...',
}: UserPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Dead-end cache: prefixes that returned 0 results ──
  // If user types "abc" and gets 0 results, "abcx", "abcy" etc. skip the API call
  const deadEndsRef = useRef(new Set<string>());
  // Track the last query we actually searched (to know when to re-search)
  const lastSearchedRef = useRef('');

  const excludedSet = new Set([...excludedUserIds, ...selected.map((u) => u.id)]);

  /** Check if query is under a dead-end prefix */
  const isUnderDeadEnd = useCallback((q: string): boolean => {
    const lower = q.toLowerCase();
    for (const dead of deadEndsRef.current) {
      if (lower.startsWith(dead)) return true;
    }
    return false;
  }, []);

  /** Clear dead-ends that are no longer relevant (user backspaced) */
  const pruneDeadEnds = useCallback((q: string) => {
    const lower = q.toLowerCase();
    for (const dead of deadEndsRef.current) {
      // If current query no longer starts with this dead-end, remove it
      if (!lower.startsWith(dead)) {
        deadEndsRef.current.delete(dead);
      }
    }
  }, []);

  // ── Search with dead-end optimization ──
  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      lastSearchedRef.current = '';
      return;
    }

    const lower = trimmed.toLowerCase();

    // Prune dead-ends that are no longer relevant (user backspaced)
    pruneDeadEnds(lower);

    // If this exact query was already searched, skip
    if (lower === lastSearchedRef.current) return;

    // If query extends a dead-end prefix, show "not found" instantly
    if (isUnderDeadEnd(lower)) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id,username,full_name,avatar_url')
        .or(`full_name.ilike.%${trimmed}%,username.ilike.%${trimmed}%`)
        .limit(8);

      const filtered = (data ?? []).filter((u: any) => !excludedSet.has(u.id));
      setResults(filtered);
      lastSearchedRef.current = lower;

      // If 0 results, mark this query as a dead-end
      if (filtered.length === 0) {
        deadEndsRef.current.add(lower);
      }
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [excludedSet, isUnderDeadEnd, pruneDeadEnds]);

  // ── Debounced search trigger ──
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void doSearch(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, doSearch]);

  // ── Close dropdown on outside click ──
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Pick a user ──
  const pick = (user: PickedUser) => {
    onSelectionChange([...selected, user]);
    setQuery('');
    setResults([]);
    lastSearchedRef.current = '';
    inputRef.current?.focus();
  };

  // ── Remove a picked user ──
  const remove = (userId: string) => {
    onSelectionChange(selected.filter((u) => u.id !== userId));
  };

  const showDropdown = open && (query.trim().length > 0 || results.length > 0);
  const trimmedQuery = query.trim().toLowerCase();
  const isDeadEnd = trimmedQuery.length > 0 && deadEndsRef.current.has(trimmedQuery);

  return (
    <div ref={wrapperRef} className="relative w-full">
      {/* ── Selected chips ── */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((u) => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-1 rounded-full text-xs font-medium
                         bg-moss-500/15 text-accent border border-moss-500/25
                         dark:bg-moss-500/10 dark:text-moss-300 dark:border-moss-500/20"
            >
              <Avatar name={u.full_name || u.username} id={u.id} size={18} src={u.avatar_url || undefined} />
              <span className="max-w-[100px] truncate text-fg">{u.full_name || u.username}</span>
              <button
                type="button"
                onClick={() => remove(u.id)}
                className="ml-0.5 p-0.5 rounded-full hover:bg-red-500/15 text-fg-muted hover:text-red-400 transition"
                disabled={disabled}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── Search input ── */}
      <div className="relative flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
          <input
            ref={inputRef}
            className="input pl-9 pr-8 w-full"
            placeholder={placeholder}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            disabled={disabled}
          />
          {searching && (
            <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted animate-spin" />
          )}
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled || selected.length === 0}
          className="btn-primary text-xs px-3 py-2 flex items-center gap-1.5 shrink-0 disabled:opacity-40"
        >
          <UserPlus size={14} />
          Tambah{selected.length > 0 ? ` (${selected.length})` : ''}
        </button>
      </div>

      {/* ── Dropdown ── */}
      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border surface-border bg-white dark:bg-[#1a2742] shadow-xl overflow-hidden animate-slide-up">
          {searching ? (
            <div className="px-4 py-3 text-xs text-fg-muted flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" /> Mencari...
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-xs text-fg-muted">
              {query.trim() ? 'Pengguna tidak ditemukan.' : 'Ketik nama atau username untuk mencari.'}
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {results.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => pick(u)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent-muted/10 transition-colors"
                >
                  <Avatar name={u.full_name || u.username} id={u.id} size={34} src={u.avatar_url || undefined} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-fg truncate">{u.full_name || u.username}</p>
                    <p className="text-[11px] text-fg-muted truncate">@{u.username}</p>
                  </div>
                  <UserPlus size={14} className="text-fg-muted shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
