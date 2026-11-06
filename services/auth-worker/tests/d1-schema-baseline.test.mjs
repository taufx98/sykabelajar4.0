import assert from "node:assert/strict";
import test from "node:test";
import { stripRegistrationColumnsFromUserBaseline } from "../src/d1-schema-baseline.mjs";

test("removes only registration attributes from the already-applied Better Auth baseline", () => {
  const sql = 'CREATE TABLE "user" ("id" text not null primary key, "name" text not null, "email" text not null, "accountType" text, "username" text, "referralCode" text);';
  const result = stripRegistrationColumnsFromUserBaseline(sql);
  assert.equal(result, 'CREATE TABLE "user" ("id" text not null primary key, "name" text not null, "email" text not null);');
});

test("removes custom attributes from CREATE TABLE IF NOT EXISTS form", () => {
  const sql = 'CREATE TABLE IF NOT EXISTS "user" ("id" text, "accountType" text, "username" text, "referralCode" text);';
  assert.equal(
    stripRegistrationColumnsFromUserBaseline(sql),
    'CREATE TABLE IF NOT EXISTS "user" ("id" text);',
  );
});

test("leaves other tables untouched even when they have similarly named columns", () => {
  const sql = 'CREATE TABLE "account" ("id" text, "username" text, "referralCode" text);';
  assert.equal(stripRegistrationColumnsFromUserBaseline(sql), sql);
});

test("fails instead of silently producing an incomplete baseline when fields drift", () => {
  const sql = 'CREATE TABLE "user" ("id" text, "accountType" text, "username" text);';
  assert.throws(
    () => stripRegistrationColumnsFromUserBaseline(sql),
    /BETTER_AUTH_USER_BASELINE_COLUMN_MISSING_referralCode/,
  );
});
