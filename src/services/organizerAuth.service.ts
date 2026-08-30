import { supabase } from '@/lib/supabase';

/**
 * Resolve the current user's organizer.
 * Priority: owner → member. Returns null if user has no organizer.
 */
export async function resolveCurrentUserOrganizer(): Promise<{
  id: string;
  name: string;
  slug?: string;
  status?: string;
  _memberRole?: string;
} | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  // 1. Check if user owns an org
  const { data: ownerOrg } = await supabase
    .from('organizers')
    .select('id,name,slug,status')
    .eq('owner_user_id', auth.user.id)
    .maybeSingle();

  if (ownerOrg) return ownerOrg;

  // 2. Check if user is a member of any org
  const { data: membership } = await supabase
    .from('organizer_members')
    .select('organizer_id,role')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (!membership) return null;

  const { data: memberOrg } = await supabase
    .from('organizers')
    .select('id,name,slug,status')
    .eq('id', membership.organizer_id)
    .maybeSingle();

  if (!memberOrg) return null;

  return { ...memberOrg, _memberRole: membership.role };
}
