export type ApplicationIdentitySnapshot = {
  initialized?: boolean;
  userId?: string | null;
} | null;

export type ApplicationIdentityReaderDependencies = {
  getSnapshot: () => ApplicationIdentitySnapshot;
  getFallbackUserId: () => Promise<string | null | undefined>;
};

export function createApplicationIdentityReader(
  dependencies: ApplicationIdentityReaderDependencies,
): () => Promise<string | null>;
