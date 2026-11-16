export interface InitialProfileInput {
  username?: unknown;
  fullName?: unknown;
  birthDate?: unknown;
  institution?: unknown;
  grade?: unknown;
  subjects?: unknown;
}

export const PROFILE_USERNAME_PATTERN: RegExp;
export function needsInitialProfileCompletion(user: { username?: string | null } | null | undefined): boolean;
export function validateInitialProfile(input: InitialProfileInput): string | null;
