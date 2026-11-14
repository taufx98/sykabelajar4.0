const REGISTRATION_COLUMNS = [
  "accountType",
  "username",
  "referralCode",
  "birthDate",
  "institution",
  "grade",
  "subjects",
];

/**
 * Keeps the first-party Better Auth baseline migration immutable after it has
 * been applied to remote D1. Registration attributes are added by migration
 * 0004 so local and remote migration histories remain identical.
 *
 * @param {string} sql
 * @returns {string}
 */
export function stripRegistrationColumnsFromUserBaseline(sql) {
  if (!/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["']?user["']?\s*\(/i.test(sql)) {
    return sql;
  }

  let result = sql;
  for (const column of REGISTRATION_COLUMNS) {
    const pattern = new RegExp(
      `,\\s*"${column}"\\s+text(?=\\s*(?:,|\\)))`,
      "i",
    );
    if (!pattern.test(result)) {
      throw new Error("BETTER_AUTH_USER_BASELINE_COLUMN_MISSING_" + column);
    }
    result = result.replace(pattern, "");
  }
  return result;
}
