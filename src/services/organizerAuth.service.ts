import { supabase } from '@/lib/supabase';

export type CurrentOrganizer = {
  id: string;
  name: string;
  slug?: string;
  status?: string;
  _memberRole?: string;
};

/**
 * Resolve the current user's organizer safely.
 * Owner wins; otherwise only an ACTIVE member is accepted.
 */
export async function resolveCurrentUserOrganizer(): Promise<CurrentOrganizer | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: ownerOrg, error: ownerError } = await supabase
    .from('organizers')
    .select('id,name,slug,status')
    .eq('owner_user_id', auth.user.id)
    .maybeSingle();

  if (ownerError) throw ownerError;
  if (ownerOrg && ownerOrg.status === 'ACTIVE') {
    return { ...ownerOrg, _memberRole: 'owner' };
  }

  const { data: membership, error: membershipError } = await supabase
    .from('organizer_members')
    .select('organizer_id,role,member_role,status,is_active')
    .eq('user_id', auth.user.id)
    .eq('status', 'ACTIVE')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (!membership) return null;

  const { data: memberOrg, error: memberOrgError } = await supabase
    .from('organizers')
    .select('id,name,slug,status')
    .eq('id', membership.organizer_id)
    .eq('status', 'ACTIVE')
    .maybeSingle();

  if (memberOrgError) throw memberOrgError;
  if (!memberOrg) return null;

  return {
    ...memberOrg,
    _memberRole: membership.role || membership.member_role || 'editor',
  };
}
