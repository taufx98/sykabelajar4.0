-- Additive migration: do not rewrite 0001 after it has been applied remotely.
-- These attributes are not authorization claims. Profile-bootstrap fields are
-- cleared after the trusted Postgres projection succeeds; only accountType and
-- username remain as stable role/profile mapping metadata on the auth user.
ALTER TABLE "user" ADD COLUMN "accountType" text;
ALTER TABLE "user" ADD COLUMN "username" text;
ALTER TABLE "user" ADD COLUMN "referralCode" text;
ALTER TABLE "user" ADD COLUMN "birthDate" text;
ALTER TABLE "user" ADD COLUMN "institution" text;
ALTER TABLE "user" ADD COLUMN "grade" text;
ALTER TABLE "user" ADD COLUMN "subjects" text;
