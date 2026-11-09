export interface AuthHydrationGate {
  begin(): number;
  invalidate(): number;
  isCurrent(request: number): boolean;
}

export function createAuthHydrationGate(): AuthHydrationGate;
