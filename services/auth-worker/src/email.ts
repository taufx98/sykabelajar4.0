import { decryptEmailSecret } from "./email-secret.mjs";
import { deliverAuthEmail } from "./email-delivery.mjs";
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
  sender_address: string;
  sender_name: string;
  bounce_address: string | null;
  send_mail_token_ciphertext: string;
};

export async function sendAuthEmail(
  env: AuthWorkerEnv,
  message: AuthEmailMessage,
): Promise<void> {
  const provider = (env.AUTH_EMAIL_PROVIDER ?? "webhook").trim().toLowerCase();

  if (provider === "zeptomail") {
    if (!env.AUTH_EMAIL_ENCRYPTION_KEY || env.AUTH_EMAIL_ENCRYPTION_KEY.length < 32) {
      throw new Error("AUTH_EMAIL_ENCRYPTION_KEY_NOT_CONFIGURED");
    }

    const active = await env.DB.prepare(
      "SELECT a.id, a.sender_address, a.sender_name, a.bounce_address, a.send_mail_token_ciphertext " +
      "FROM auth_email_settings s JOIN auth_email_accounts a ON a.id = s.active_account_id " +
      "WHERE s.id = 1",
    ).first<ActiveEmailAccount>();

    if (!active) throw new Error("AUTH_EMAIL_ACTIVE_AGENT_NOT_CONFIGURED");

    const sendMailToken = await decryptEmailSecret(
      env.AUTH_EMAIL_ENCRYPTION_KEY,
      active.send_mail_token_ciphertext,
    );
    await sendZeptoMail({
      sendMailToken,
      senderAddress: active.sender_address,
      senderName: active.sender_name,
      bounceAddress: active.bounce_address,
    }, message);
    return;
  }

  if (provider !== "webhook") {
    throw new Error("AUTH_EMAIL_PROVIDER_UNSUPPORTED");
  }
  await deliverAuthEmail(env, message);
}
