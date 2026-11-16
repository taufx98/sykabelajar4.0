const BREVO_SEND_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/**
 * Sends a transactional email using a Brevo API key stored encrypted in D1.
 * Provider response bodies and API keys are never returned or logged.
 *
 * @param {{apiKey:string,senderAddress:string,senderName:string}} account
 * @param {{to:string,subject:string,text:string,action?:string}} message
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<{messageId:string|null}>}
 */
export async function sendBrevoEmail(account, message, fetcher = fetch) {
  const apiKey = typeof account?.apiKey === "string" ? account.apiKey.trim() : "";
  const senderAddress = typeof account?.senderAddress === "string" ? account.senderAddress.trim() : "";
  const senderName = typeof account?.senderName === "string" ? account.senderName.trim() : "";
  const to = typeof message?.to === "string" ? message.to.trim() : "";
  const subject = typeof message?.subject === "string" ? message.subject.trim() : "";
  const text = typeof message?.text === "string" ? message.text : "";

  if (!apiKey || !senderAddress || !senderName || !to || !subject || !text) {
    throw new Error("BREVO_CONFIGURATION_INCOMPLETE");
  }

  const payload = {
    sender: { name: senderName, email: senderAddress },
    to: [{ email: to }],
    subject,
    textContent: text,
    tags: ["sykabelajar-auth", typeof message.action === "string" ? message.action : "admin-test"],
  };

  let response;
  try {
    response = await fetcher(BREVO_SEND_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error("BREVO_CONNECTION_FAILED");
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("BREVO_AUTH_FAILED");
  }
  if (!response.ok) {
    throw new Error("BREVO_SEND_FAILED");
  }

  const result = await response.json().catch(() => ({}));
  const messageId = result && typeof result.messageId === "string" ? result.messageId : null;
  return { messageId };
}
