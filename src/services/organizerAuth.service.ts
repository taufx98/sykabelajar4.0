import { supabase } from '@/lib/supabase';

export type CurrentOrganizer = {
  id: string;
  name: string;
  slug?: string;
  status?: string;
  logo_asset_url?: string | null;
  _memberRole?: string;
};

export const ORGANIZER_SELECTION_KEY = 'syka.selectedOrganizerId';

export async function listCurrentUserOrganizers(): Promise<CurrentOrganizer[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];

  const [ownedResult, membershipResult] = await Promise.all([
    supabase
      .from('organizers')
      .select('id,name,slug,status,logo_asset_url')
      .eq('owner_user_id', auth.user.id)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: true }),
    supabase
      .from('organizer_members')
      .select('organizer_id,role,member_role,status, is_active,created_at')
      .eq('user_id', auth.user.id)
      .eq('status', 'ACTIVE')
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
  ]);

  if (ownedResult.error) throw ownedResult.error;
  if (membershipResult.error) throw membershipResult.error;

  const owned = (ownedResult.data ?? []).map((org: any) => ({ ...org, _memberRole: 'owner' }));
  const ownedIds = new Set(owned.map((org) => org.id));
  const memberIds = (membershipResult.data ?? []).map((m: any) => m.organizer_id).filter((id: string) => !ownedIds.has(id));

  if (!memberIds.length) return owned;

  const { data: memberOrgs, error: memberOrgError } = await supabase
    .from('organizers')
    .select('id,name,slug,status,logo_asset_url')
    .in('id', memberIds)
    .eq('status', 'ACTIVE');
  if (memberOrgError) throw memberOrgError;

  const roleByOrg = new Map<string, string>();
  for (const row of membershipResult.data ?? []) {
    roleByOrg.set(row.organizer_id, row.role || row.member_role || 'editor');
  }

  return [
    ...owned,
    ...(memberOrgs ?? []).map((org: any) => ({ ...org, _memberRole: roleByOrg.get(org.id) || 'editor' })),
  ];
}

export function getSelectedOrganizerId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ORGANIZER_SELECTION_KEY);
}

export function setSelectedOrganizerId(id: string | null): void {
  if (typeof window === 'undefined') return;
  if (id) window.localStorage.setItem(ORGANIZER_SELECTION_KEY, id);
  else window.localStorage.removeItem(ORGANIZER_SELECTION_KEY);
}

export async function resolveCurrentUserOrganizer(): Promise<CurrentOrganizer | null> {
  const organizers = await listCurrentUserOrganizers();
  if (!organizers.length) {
    setSelectedOrganizerId(null);
    return null;
  }

  const selectedId = getSelectedOrganizerId();
  const selected = selectedId ? organizers.find((org) => org.id === selectedId) : null;
  if (selected) return selected;

  const fallback = organizers[0];
  setSelectedOrganizerId(fallback.id);
  return fallback;
}
