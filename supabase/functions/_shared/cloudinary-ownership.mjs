const SAFE_SEGMENT = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

function normalizePublicId(value) {
  if (typeof value !== "string") return null;
  const publicId = value.trim();
  if (
    !publicId ||
    publicId.length > 240 ||
    publicId !== value.trim() ||
    !/^[a-z0-9_./-]+$/i.test(publicId) ||
    publicId.startsWith("/") ||
    publicId.endsWith("/") ||
    publicId.includes("//") ||
    publicId.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) return null;
  return publicId;
}

/**
 * The signer is limited to the current user's own avatar/cover namespace or
 * an organizer workspace they own. Callers must pass profile/organizer rows
 * fetched with the caller-scoped Supabase client (never service-role rows).
 */
export function isOwnedCloudinaryPublicId(publicIdInput, { username, ownedOrganizers = [] } = {}) {
  const publicId = normalizePublicId(publicIdInput);
  if (!publicId) return false;

  const normalizedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
  if (SAFE_SEGMENT.test(normalizedUsername)) {
    const ownProfilePrefix = `sykabelajar/${normalizedUsername}/`;
    if (
      publicId === ownProfilePrefix + "profile" ||
      publicId === ownProfilePrefix + "cover"
    ) return true;
  }

  if (!Array.isArray(ownedOrganizers)) return false;
  for (const organizer of ownedOrganizers) {
    if (!organizer || typeof organizer !== "object") continue;
    const candidates = [organizer.slug, organizer.id]
      .filter((value) => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => SAFE_SEGMENT.test(value));

    for (const candidate of candidates) {
      if (publicId === `sykabelajar/organizers/${candidate}/profile`) return true;
    }
  }
  return false;
}
