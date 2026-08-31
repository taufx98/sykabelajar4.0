import { BadgeCheck, ShieldCheck } from 'lucide-react';

export type VerificationType = 'blue' | 'gold' | 'orange' | 'admin-shield' | null | undefined;

export function VerifiedMark({ type, size = 17 }: { type: VerificationType; size?: number }) {
  if (type === 'admin-shield') return <ShieldCheck size={size} className="text-sky-400" aria-label="Admin" />;
  if (!type) return null;
  const cls = type === 'blue' ? 'text-sky-400' : type === 'gold' ? 'text-amber-400' : 'text-orange-400';
  return <BadgeCheck size={size} className={cls} aria-label={type === 'blue' ? 'Official user' : type === 'gold' ? 'Official guru' : 'Official organisasi'} />;
}
