import type { AuthWorkerEnv } from "./env";

type AuthEmailMessage = {
  to: string;
  subject: string;
  text: string;
  action: "verify-email" | "reset-password";
};

export async function sendAuthEmail(
  env: AuthWorkerEnv,
  message: AuthEmailMessage,
): Promise<void> {
  const endpoint = env.AUTH_EMAIL_WEBHOOK_URL?.trim();
  const token = env.AUTH_EMAIL_WEBHOOK_TOKEN?.trim();
  const from = env.AUTH_EMAIL_FROM?.trim();

  if (!endpoint || !token || !from) {
    throw new Error("AUTH_EMAIL_DELIVERY_NOT_CONFIGURED");
  }

  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== "https:" && endpointUrl.hostname !== "localhost") {
    throw new Error("AUTH_EMAIL_ENDPOINT_MUST_USE_HTTPS");
  }

  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      category: message.action,
    }),
  });

  if (!response.ok) {
    throw new Error("AUTH_EMAIL_DELIVERY_FAILED");
  }
}
