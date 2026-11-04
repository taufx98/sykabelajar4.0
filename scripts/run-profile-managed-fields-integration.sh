#!/usr/bin/env bash
set -euo pipefail

: "${PROFILE_SECURITY_TEST_DATABASE_URL:?PROFILE_SECURITY_TEST_DATABASE_URL must point to the disposable PostgreSQL test service}"

case "$PROFILE_SECURITY_TEST_DATABASE_URL" in
  "postgres://postgres:postgres@localhost:5432/postgres"|"postgresql://postgres:postgres@localhost:5432/postgres")
    ;;
  *)
    echo "Refusing to run profile security integration SQL against an unapproved database URL." >&2
    exit 1
    ;;
esac

psql "$PROFILE_SECURITY_TEST_DATABASE_URL" \
  --no-psqlrc \
  --set ON_ERROR_STOP=1 \
  --file scripts/profile-managed-fields-integration.sql
