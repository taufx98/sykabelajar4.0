# D1 migrations

Generate the schema from the exact Better Auth and OAuth Provider configuration in src/auth.ts using the pinned Better Auth CLI.

The generated output must include the core Better Auth tables, JWKS storage, OAuth Provider tables, and the rate-limit table (rateLimit). Do not hand-write a partial Better Auth schema.

Review the generated SQL, commit the SQL file here, and verify it by applying it to a disposable D1 database before deploying the Worker. Never run schema generation or migration against production.
