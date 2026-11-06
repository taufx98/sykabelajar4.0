-- Additive migration: do not rewrite 0001 after it has been applied remotely.
-- These attributes are registration metadata only, not authorization claims.
ALTER TABLE "user" ADD COLUMN "accountType" text;
ALTER TABLE "user" ADD COLUMN "username" text;
ALTER TABLE "user" ADD COLUMN "referralCode" text;
