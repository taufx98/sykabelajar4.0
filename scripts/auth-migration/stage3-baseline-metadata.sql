WITH function_meta AS (
  SELECT
    n.nspname::text AS schema_name,
    p.proname::text AS function_name,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    pg_get_function_result(p.oid) AS result_type,
    p.prosecdef AS security_definer,
    p.provolatile::text AS volatility,
    p.proparallel::text AS parallel_safety,
    p.proisstrict AS is_strict,
    p.proretset AS returns_set,
    COALESCE(to_jsonb(p.proconfig), '[]'::jsonb) AS function_config,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'grantee',
          CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname::text END,
          'privilege_type', acl.privilege_type,
          'is_grantable', acl.is_grantable,
          'grantor', grantor.rolname::text
        )
        ORDER BY CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname::text END,
          acl.privilege_type
      )
      FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
      LEFT JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
      JOIN pg_roles AS grantor ON grantor.oid = acl.grantor
    ), '[]'::jsonb) AS function_acl_entries,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
    has_function_privilege('postgres', p.oid, 'EXECUTE') AS postgres_execute,
    md5(pg_get_functiondef(p.oid)) AS definition_md5
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'private')
    AND p.proname::text IN (
      'apply_referral_qualification',
      'capture_signup_referral',
      'process_referral_email_confirmation',
      'create_organizer',
      'get_my_referrals',
      'get_my_referrals_v2',
      'get_my_verified_referrals',
      'handle_new_auth_user',
      'register_for_competition',
      'verify_pending_referrals'
    )
),
stage5_payment_function_meta AS (
  SELECT
    n.nspname::text AS schema_name,
    p.proname::text AS function_name,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    p.prosecdef AS security_definer,
    COALESCE(to_jsonb(p.proconfig), '[]'::jsonb) AS function_config,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'grantee',
          CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname::text END,
          'privilege_type', acl.privilege_type,
          'is_grantable', acl.is_grantable,
          'grantor', grantor.rolname::text
        )
        ORDER BY CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname::text END,
          acl.privilege_type
      )
      FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
      LEFT JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
      JOIN pg_roles AS grantor ON grantor.oid = acl.grantor
    ), '[]'::jsonb) AS function_acl_entries,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
    has_function_privilege('postgres', p.oid, 'EXECUTE') AS postgres_execute
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE p.oid = to_regprocedure('public.process_payment_gateway_success(uuid,text,uuid)')
),
trigger_meta AS (
  SELECT
    ns.nspname::text AS table_schema,
    tbl.relname::text AS table_name,
    t.tgname::text AS trigger_name,
    t.tgenabled::text AS enabled_state,
    t.tgtype AS trigger_type_flags,
    pg_get_triggerdef(t.oid, true) AS definition,
    fn_ns.nspname::text AS function_schema,
    fn.proname::text AS function_name,
    pg_get_function_identity_arguments(fn.oid) AS function_identity_arguments,
    pg_get_functiondef(fn.oid) AS function_definition,
    md5(pg_get_functiondef(fn.oid)) AS function_definition_md5
  FROM pg_trigger AS t
  JOIN pg_class AS tbl ON tbl.oid = t.tgrelid
  JOIN pg_namespace AS ns ON ns.oid = tbl.relnamespace
  JOIN pg_proc AS fn ON fn.oid = t.tgfoid
  JOIN pg_namespace AS fn_ns ON fn_ns.oid = fn.pronamespace
  WHERE NOT t.tgisinternal
    AND ((ns.nspname = 'auth' AND tbl.relname = 'users')
      OR (ns.nspname = 'public' AND tbl.relname = 'profiles'))
),
uid_policy_meta AS (
  SELECT
    ns.nspname::text AS table_schema,
    tbl.relname::text AS table_name,
    pol.polname::text AS policy_name,
    CASE WHEN pol.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END AS policy_mode,
    CASE pol.polcmd
      WHEN 'r' THEN 'SELECT'
      WHEN 'a' THEN 'INSERT'
      WHEN 'w' THEN 'UPDATE'
      WHEN 'd' THEN 'DELETE'
      WHEN '*' THEN 'ALL'
    END AS command,
    COALESCE((
      SELECT jsonb_agg(role_names.role_name ORDER BY role_names.role_name)
      FROM (
        SELECT CASE WHEN role_entry.role_oid = 0 THEN 'PUBLIC' ELSE gr.rolname::text END AS role_name
        FROM unnest(pol.polroles) AS role_entry(role_oid)
        LEFT JOIN pg_roles AS gr ON gr.oid = role_entry.role_oid
      ) AS role_names
    ), '[]'::jsonb) AS roles,
    md5(COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '')) AS using_expression_md5,
    md5(COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) AS check_expression_md5,
    tbl.relrowsecurity AS row_security_enabled,
    tbl.relforcerowsecurity AS row_security_forced
  FROM pg_policy AS pol
  JOIN pg_class AS tbl ON tbl.oid = pol.polrelid
  JOIN pg_namespace AS ns ON ns.oid = tbl.relnamespace
  WHERE ns.nspname IN ('public', 'private')
    AND (
      COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') ILIKE '%auth.uid%'
      OR COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ILIKE '%auth.uid%'
    )
),
uid_policy_tables AS (
  SELECT DISTINCT table_schema, table_name, row_security_enabled, row_security_forced
  FROM uid_policy_meta
),
profile_columns AS (
  SELECT
    ordinal_position,
    column_name,
    data_type,
    udt_schema,
    udt_name,
    is_nullable,
    column_default,
    is_identity,
    identity_generation,
    is_generated,
    generation_expression
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles'
)
SELECT jsonb_build_object(
  'stage5_payment_fulfillment_function',
    (SELECT to_jsonb(f) FROM stage5_payment_function_meta AS f),
  'auth_dependent_functions',
    COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.schema_name, f.function_name, f.identity_arguments)
      FROM function_meta AS f
    ), '[]'::jsonb),
  'auth_and_profile_triggers',
    COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.table_schema, t.table_name, t.trigger_name)
      FROM trigger_meta AS t
    ), '[]'::jsonb),
  'uid_policies',
    COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.table_schema, p.table_name, p.policy_name)
      FROM uid_policy_meta AS p
    ), '[]'::jsonb),
  'uid_policy_tables',
    COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.table_schema, t.table_name)
      FROM uid_policy_tables AS t
    ), '[]'::jsonb),
  'profile_columns',
    COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.ordinal_position)
      FROM profile_columns AS c
    ), '[]'::jsonb)
)::text;
