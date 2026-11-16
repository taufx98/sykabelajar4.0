export function safeBetterAuthErrorCode(body: unknown): string;

export type SocialAuthErrorCategory = "account_not_linked" | "cancelled" | "failed";
export function getSocialAuthErrorCategory(value: unknown): SocialAuthErrorCategory;
