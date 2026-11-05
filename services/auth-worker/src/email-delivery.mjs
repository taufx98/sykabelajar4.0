const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";

/**
 * Deliver an authentication email through the configured provider.
 *
 * @param {{
 *   AUTH_EMAIL_PROVIDER?: string;
 *   AUTH_EMAIL_FROM?: string;
 *   AUTH_EMAIL_WEBHOOK_URL?: string;
 *   AUTH_EMAIL_WEBHOOK_TOKEN?: string;
 *   RESEND_API_KEY?: string;
 * }} env
 * @param {{ to: string; subject: string; text: string; action: "verify-email" | "reset-password" }} message
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<void>}
 */
export async function deliverAuthEmail(env, message, fetcher = fetch) {
  const provider = (env.AUTH_EMAIL_PROVIDER ?? "webhook").trim().toLowerCase();
  const from = env.AUTH_EMAIL_FROM?.trim();

  if (!from) {
    throw new Error("AUTH_EMAIL_DELIVERY_NOT_CONFIGURED");
  }

  if (provider === "resend") {
    const apiKey = env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("AUTH_EMAIL_DELIVERY_NOT_CONFIGURED");
    }

    const response = await fetcher(RESEND_EMAILS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });

    if (!response.ok) {
      // Never expose provider response bodies, recipient details, or credentials.
      throw new Error("AUTH_EMAIL_DELIVERY_FAILED");
    }
    return;
  }

  if (provider !== "webhook") {
    throw new Error("AUTH_EMAIL_PROVIDER_UNSUPPORTED");
  }

  const endpoint = env.AUTH_EMAIL_WEBHOOK_URL?.trim();
  const token = env.AUTH_EMAIL_WEBHOOK_TOKEN?.trim();
  if (!endpoint || !token) {
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
