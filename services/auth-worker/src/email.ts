import { decryptEmailSecret } from "./email-secret.mjs";
import { deliverAuthEmail, isEmailDeliveryConfigured } from "./email-delivery.mjs";
import { sendBrevoEmail } from "./brevo.mjs";
import { sendZeptoMail } from "./zeptomail.mjs";
import type { AuthWorkerEnv } from "./env";

type AuthEmailMessage = {
  to: string;
  subject: string;
  text: string;
  action: "verify-email" | "reset-password";
};

type ActiveEmailAccount = {
  id: string;
  provider: "zeptomail" | "brevo";
  sender_address: string;
  sender_name: string;
  bounce_address: string | null;
  send_mail_token_ciphertext: string;
};

/**
 * "managed" selects the active provider account stored encrypted in D1.
 * "webhook" is retained for isolated local development only.
 */
/**
 * Return whether the configured email path can support the local verification
 * challenge. This is a configuration check only; it never sends a message.
 * Email remains optional for providers that return a trusted verified-email
 * claim (Google and X), but Facebook requires this local delivery path.
 */
export async function isAuthEmailVerificationConfigured(env: AuthWorkerEnv): Promise<boolean> {
  const providerMode = (env.AUTH_EMAIL_PROVIDER ?? "webhook").trim().toLowerCase();
  if (providerMode === "webhook") return isEmailDeliveryConfigured(env);
  if (providerMode !== "managed") return false;
  if (!env.AUTH_EMAIL_ENCRYPTION_KEY || env.AUTH_EMAIL_ENCRYPTION_KEY.length < 32) return false;

  try {
    const active = await env.DB.prepare(
      "SELECT a.provider, a.sender_address, a.sender_name, a.send_mail_token_ciphertext " +
      "FROM auth_email_settings s JOIN auth_email_accounts a ON a.id = s.active_account_id " +
      "WHERE s.id = 1",
    ).first<Pick<ActiveEmailAccount, "provider" | "sender_address" | "sender_name" | "send_mail_token_ciphertext">>();
    if (
      !active ||
      (active.provider !== "zeptomail" && active.provider !== "brevo") ||
      !active.sender_address.trim() ||
      !active.sender_name.trim() ||
      !active.send_mail_token_ciphertext
    ) return false;

    const credential = await decryptEmailSecret(
      env.AUTH_EMAIL_ENCRYPTION_KEY,
      active.send_mail_token_ciphertext,
    );
    return credential.trim().length > 0;
  } catch {
    return false;
  }
}

export async function sendAuthEmail(
  env: AuthWorkerEnv,
  message: AuthEmailMessage,
): Promise<void> {
  const providerMode = (env.AUTH_EMAIL_PROVIDER ?? "webhook").trim().toLowerCase();

  if (providerMode === "managed") {
    if (!env.AUTH_EMAIL_ENCRYPTION_KEY || env.AUTH_EMAIL_ENCRYPTION_KEY.length < 32) {
      throw new Error("AUTH_EMAIL_ENCRYPTION_KEY_NOT_CONFIGURED");
    }

    const active = await env.DB.prepare(
      "SELECT a.id, a.provider, a.sender_address, a.sender_name, a.bounce_address, a.send_mail_token_ciphertext " +
      "FROM auth_email_settings s JOIN auth_email_accounts a ON a.id = s.active_account_id " +
      "WHERE s.id = 1",
    ).first<ActiveEmailAccount>();

    if (!active) throw new Error("AUTH_EMAIL_ACTIVE_ACCOUNT_NOT_CONFIGURED");

    const credential = await decryptEmailSecret(
      env.AUTH_EMAIL_ENCRYPTION_KEY,
      active.send_mail_token_ciphertext,
    );

    if (active.provider === "brevo") {
      await sendBrevoEmail({
        apiKey: credential,
        senderAddress: active.sender_address,
        senderName: active.sender_name,
      }, message);
      return;
    }

    if (active.provider === "zeptomail") {
      await sendZeptoMail({
        sendMailToken: credential,
        senderAddress: active.sender_address,
        senderName: active.sender_name,
        bounceAddress: active.bounce_address,
      }, message);
      return;
    }

    throw new Error("AUTH_EMAIL_PROVIDER_UNSUPPORTED");
  }

  if (providerMode !== "webhook") {
    throw new Error("AUTH_EMAIL_PROVIDER_UNSUPPORTED");
  }
  await deliverAuthEmail(env, message);
}
