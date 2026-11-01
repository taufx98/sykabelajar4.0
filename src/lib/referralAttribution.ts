const PENDING_REFERRAL_KEY = 'syka_pending_referral_v1';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReferralStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function resolveStorage(storage?: ReferralStorage): ReferralStorage | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function isValidReferralId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

export function storePendingReferral(value: string, storage?: ReferralStorage): boolean {
  const target = resolveStorage(storage);
  const referralId = value.trim();
  if (!target || !isValidReferralId(referralId)) return false;
  target.setItem(PENDING_REFERRAL_KEY, referralId);
  return true;
}

export function getPendingReferral(storage?: ReferralStorage): string | null {
  const target = resolveStorage(storage);
  if (!target) return null;
  const value = target.getItem(PENDING_REFERRAL_KEY);
  return isValidReferralId(value) ? value.trim() : null;
}

export function clearPendingReferral(storage?: ReferralStorage): void {
  resolveStorage(storage)?.removeItem(PENDING_REFERRAL_KEY);
}
