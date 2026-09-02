-- Keep certificate QR payload domain-agnostic.
-- The frontend resolves verification URLs from the current site origin.

CREATE OR REPLACE FUNCTION public.assign_organizer_serial(p_serial_id uuid, p_certificate_id uuid)
RETURNS public.organizer_serials
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_serial public.organizer_serials;
  v_cert public.certificates;
  v_org uuid;
  v_code text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO v_serial
  FROM public.organizer_serials
  WHERE id = p_serial_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SERIAL_NOT_FOUND'; END IF;

  SELECT * INTO v_cert
  FROM public.certificates
  WHERE id = p_certificate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CERTIFICATE_NOT_FOUND'; END IF;

  SELECT organizer_id INTO v_org
  FROM public.competitions
  WHERE id = v_cert.competition_id;
  IF v_org IS NULL OR v_org <> v_serial.organizer_id THEN
    RAISE EXCEPTION 'SERIAL_CERTIFICATE_ORGANIZER_MISMATCH';
  END IF;

  IF NOT (private.current_user_is_admin() OR private.current_user_can_manage_organizer(v_org)) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  PERFORM private.require_organizer_entitlement(v_org, 'certificate_serials');

  IF v_serial.status <> 'AVAILABLE' THEN RAISE EXCEPTION 'SERIAL_UNAVAILABLE'; END IF;

  SELECT verification_code INTO v_code
  FROM public.certificate_verifications
  WHERE certificate_id = p_certificate_id
  ORDER BY issued_at DESC NULLS LAST
  LIMIT 1;
  IF v_code IS NULL THEN RAISE EXCEPTION 'CERTIFICATE_VERIFICATION_NOT_FOUND'; END IF;

  UPDATE public.organizer_serials
  SET status = 'ASSIGNED',
      certificate_id = p_certificate_id,
      assigned_at = now(),
      qr_payload = v_code
  WHERE id = p_serial_id
  RETURNING * INTO v_serial;

  UPDATE public.certificates
  SET serial_number = v_serial.serial_code,
      updated_at = now()
  WHERE id = p_certificate_id;

  RETURN v_serial;
END;
$$;

-- Normalize any already-assigned rows created by the previous implementation.
UPDATE public.organizer_serials os
SET qr_payload = cv.verification_code
FROM public.certificate_verifications cv
WHERE os.certificate_id = cv.certificate_id
  AND os.status = 'ASSIGNED'
  AND cv.verification_code IS NOT NULL
  AND (os.qr_payload LIKE 'http://%' OR os.qr_payload LIKE 'https://%');
