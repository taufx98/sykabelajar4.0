-- Better Auth first-time profile completion must stay narrow and self-scoped.
DO $onboarding$
DECLARE
  v_signature text := 'public.complete_better_auth_profile(text,text,date,text,text,text)';
  v_definition text;
BEGIN
  IF to_regprocedure(v_signature) IS NULL THEN
    RAISE EXCEPTION 'Better Auth profile onboarding RPC is missing';
  END IF;

  v_definition := pg_get_functiondef(to_regprocedure(v_signature));

  IF position('SECURITY DEFINER' IN v_definition) = 0
     OR position('SET search_path TO ' || chr(39) || chr(39) IN v_definition) = 0
     OR position('auth.uid()' IN v_definition) = 0
     OR position('https://auth.sykabelajar.my.id/api/auth' IN v_definition) = 0
     OR position('private.app_users' IN v_definition) = 0
     OR position('email_verified_at' IN v_definition) = 0
     OR position('identity_origin = ''better_auth''' IN v_definition) = 0
     OR position('USERNAME_ALREADY_TAKEN' IN v_definition) = 0
     OR position('username = v_username' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Onboarding RPC is missing its verified Better Auth, own-user, or username safeguards';
  END IF;

  IF position('public.user_roles' IN v_definition) > 0
     OR position('account_type =' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Profile onboarding must never create or mutate business roles/account types';
  END IF;

  IF has_function_privilege('anon', v_signature, 'EXECUTE')
     OR has_function_privilege('public', v_signature, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'Onboarding RPC must be executable only by authenticated callers';
  END IF;
END;
$onboarding$;
