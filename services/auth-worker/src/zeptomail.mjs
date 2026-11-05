const ZEPTOMAIL_SEND_ENDPOINT = "https://api.zeptomail.com/v1.1/email";

/**
 * @typedef {Object} ZeptoMailMessage
 * @property {string} to
 * @property {string} subject
 * @property {string} text
 */

/**
 * Sends one transactional email using a Send Mail Token belonging to one Agent.
 * This adapter never returns the provider response body or token to callers.
 *
 * @param {{
 *   sendMailToken: string;
 *   senderAddress: string;
 *   senderName: string;
 *   bounceAddress?: string | null;
 * }} account
 * @param {ZeptoMailMessage} message
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<{requestId: string | null}>}
 */
export async function sendZeptoMail(account, message, fetcher = fetch) {
  const token = typeof account?.sendMailToken === "string" ? account.sendMailToken.trim() : "";
  const senderAddress = typeof account?.senderAddress === "string" ? account.senderAddress.trim() : "";
  const senderName = typeof account?.senderName === "string" ? account.senderName.trim() : "";
  const to = typeof message?.to === "string" ? message.to.trim() : "";
  const subject = typeof message?.subject === "string" ? message.subject.trim() : "";
  const text = typeof message?.text === "string" ? message.text : "";

  if (!token || !senderAddress || !senderName || !to || !subject || !text) {
    throw new Error("ZEPTO_MAIL_CONFIGURATION_INCOMPLETE");
  }

  /** @type {Record<string, unknown>} */
  const body = {
    from: { address: senderAddress, name: senderName },
    to: [{ email_address: { address: to, name: "" } }],
    subject,
    textbody: text,
    track_clicks: false,
    track_opens: false,
    client_reference: "sykabelajar-auth-transactional",
  };
  const bounceAddress = typeof account.bounceAddress === "string" ? account.bounceAddress.trim() : "";
  if (bounceAddress) body.bounce_address = bounceAddress;

  let response;
  try {
    response = await fetcher(ZEPTOMAIL_SEND_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Zoho-enczapikey " + token,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("ZEPTO_MAIL_CONNECTION_FAILED");
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("ZEPTO_MAIL_AUTH_FAILED");
  }
  if (!response.ok) {
    throw new Error("ZEPTO_MAIL_SEND_FAILED");
  }

  const result = await response.json().catch(() => ({}));
  const requestId = result && typeof result.request_id === "string" ? result.request_id : null;
  return { requestId };
}
