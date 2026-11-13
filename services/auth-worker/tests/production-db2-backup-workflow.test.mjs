import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../../.github/workflows/auth-production-db2-backup.yml", import.meta.url),
  "utf8",
);

test("Production backup workflow is pinned to the exact project and requires owner-managed encryption", () => {
  assert.match(workflow, /SUPABASE_PROJECT_REF: mvdczyitbkxkldjughor/);
  assert.match(workflow, /secrets\.SUPABASE_DB_URL/);
  assert.match(workflow, /secrets\.SUPABASE_BACKUP_AGE_RECIPIENT/);
  assert.match(workflow, /BACKUP-AND-RESTORE-PRODUCTION-DB2/);
  assert.match(workflow, /postgres:17\.6-alpine/);
});

test("the full archive is restored locally before encryption and only the encrypted file is uploaded", () => {
  assert.match(workflow, /pg_dump --format=custom/);
  assert.match(workflow, /pg_restore --exit-on-error/);
  assert.match(workflow, /sykabelajar_db2_restore/);
  const restoreAt = workflow.indexOf("Restore full DB2 backup to the disposable local database");
  const encryptAt = workflow.indexOf("Encrypt the verified full backup");
  const uploadAt = workflow.indexOf("Upload encrypted Production DB2 backup artifact");
  assert.ok(restoreAt >= 0 && encryptAt > restoreAt && uploadAt > encryptAt);
  assert.match(workflow, /age --encrypt --recipient/);
  const stopAt = workflow.indexOf("      - name: Stop isolated Supabase stack", uploadAt);
  const uploadSection = workflow.slice(uploadAt, stopAt);
  assert.ok(uploadSection.includes("production-db2.dump.age"));
  assert.equal(uploadSection.includes("production-db2.dump\n"), false);
  assert.match(workflow, /plaintext_artifact=not uploaded/);
});

test("the backup rehearsal never executes DDL/DML against Production", () => {
  assert.doesNotMatch(workflow, /supabase db push|supabase migration up/);
  assert.match(workflow, /production_ddl_or_dml=not performed/);
  assert.match(workflow, /No application rows were selected or printed/);
});
