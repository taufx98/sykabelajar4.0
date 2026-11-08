/**
 * Local-development or explicitly configured relay fallback.
 * Production staging should use the encrypted active ZeptoMail Agent profile.
 *
 * @param {{
 *   AUTH_EMAIL_WEBHOOK_URL?: string;
 *   AUTH_EMAIL_WEBHOOK_TOKEN?: string;
 *   AUTH_EMAIL_FROM?: string;
 * }} env
 * @param {{ to: string; subject: string; text: string; action: "verify-email" | "reset-password" }} message
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<void>}
 */
export function isEmailDeliveryConfigured(env) {
  const endpoint = env.AUTH_EMAIL_WEBHOOK_URL?.trim();
  const token = env.AUTH_EMAIL_WEBHOOK_TOKEN?.trim();
  const from = env.AUTH_EMAIL_FROM?.trim();
  if (!endpoint || !token || !from) return false;

  try {
    const endpointUrl = new URL(endpoint);
    const localDevelopment = endpointUrl.hostname === "localhost" || endpointUrl.hostname === "127.0.0.1";
    return endpointUrl.protocol === "https:" ||
      (localDevelopment && endpointUrl.protocol === "http:");
  } catch {
    return false;
  }
}

export async function deliverAuthEmail(env, message, fetcher = fetch) {
  const endpoint = env.AUTH_EMAIL_WEBHOOK_URL?.trim();
  const token = env.AUTH_EMAIL_WEBHOOK_TOKEN?.trim();
  const from = env.AUTH_EMAIL_FROM?.trim();

  if (!endpoint || !token || !from) {
    throw new Error("AUTH_EMAIL_DELIVERY_NOT_CONFIGURED");
  }

  const endpointUrl = new URL(endpoint);
  const localDevelopment = endpointUrl.hostname === "localhost" || endpointUrl.hostname === "127.0.0.1";
  if (endpointUrl.protocol !== "https:" && !(localDevelopment && endpointUrl.protocol === "http:")) {
    throw new Error("AUTH_EMAIL_ENDPOINT_MUST_USE_HTTPS");
  }

  const response = await fetcher(endpointUrl, {
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
