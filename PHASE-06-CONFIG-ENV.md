# Phase 06 — Config / Environment

## Implemented

- Frontend Supabase configuration is read from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Cloudinary configuration is read from `VITE_CLOUDINARY_CLOUD_NAME`, `VITE_CLOUDINARY_UPLOAD_PRESET`, and `VITE_CLOUDINARY_PROFILE_PRESET`.
- Edge Function URL is read from `VITE_EDGE_FUNCTION_URL`; when omitted, it is derived from `VITE_SUPABASE_URL` as `/functions/v1`.
- `src/lib/supabase.ts` no longer contains hardcoded Supabase URL/key values or credential-related console logging.
- `.env.example` documents the expected frontend configuration.
- `.gitignore` explicitly excludes `.env` and `.env.*` while allowing `.env.example`.
- GitHub Actions CI passes the required `VITE_*` values into the production build step.

## Required deployment secrets

Configure these repository Actions secrets before a production build is expected to pass:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_CLOUDINARY_CLOUD_NAME`
- `VITE_CLOUDINARY_UPLOAD_PRESET`
- `VITE_CLOUDINARY_PROFILE_PRESET`
- `VITE_EDGE_FUNCTION_URL` (optional; omit when the default derived URL is desired)

Never put `service_role`, database passwords, API provider secret keys, or other server-only secrets in any `VITE_*` variable.
