export const PROFILE_USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/;

export function needsInitialProfileCompletion(user) {
  return Boolean(user && (typeof user.username !== "string" || !user.username.trim()));
}

export function validateInitialProfile(input) {
  const username = typeof input?.username === "string" ? input.username.trim().toLowerCase() : "";
  const fullName = typeof input?.fullName === "string" ? input.fullName.trim() : "";
  const birthDate = typeof input?.birthDate === "string" ? input.birthDate.trim() : "";
  const institution = typeof input?.institution === "string" ? input.institution.trim() : "";
  const grade = typeof input?.grade === "string" ? input.grade.trim().toLowerCase() : "";
  const subjects = Array.isArray(input?.subjects) ? input.subjects.filter((value) => typeof value === "string") : [];

  if (!PROFILE_USERNAME_PATTERN.test(username)) return "USERNAME_INVALID";
  if (fullName.length < 2 || fullName.length > 120) return "FULL_NAME_INVALID";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(Date.parse(birthDate)) || birthDate > new Date().toISOString().slice(0, 10)) {
    return "BIRTH_DATE_INVALID";
  }
  if (institution.length < 2 || institution.length > 200) return "INSTITUTION_INVALID";
  if (!["sd", "smp", "sma", "alumni"].includes(grade)) return "EDUCATION_LEVEL_INVALID";
  const allowedSubjects = new Set(["mtk", "ipa", "ips", "bindo", "bing", "seni", "olahraga", "tech", "lingkungan"]);
  if (subjects.length < 1 || subjects.some((value) => !allowedSubjects.has(value))) return "FAVORITE_CATEGORIES_REQUIRED";
  return null;
}
