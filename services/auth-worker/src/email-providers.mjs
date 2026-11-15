const ENDPOINTS = {
  sendpulse: "https://api.sendpulse.com/smtp/emails",
  brevo: "https://api.brevo.com/v3/smtp/email",
  mailjet: "https://api.mailjet.com/v3.1/send",
  mailtrap: "https://send.api.mailtrap.io/api/send",
  resend: "https://api.resend.com/emails",
};

export class EmailProviderDeliveryError extends Error {
  /**
   * @param {string} code
   * @param {{allowFailover?: boolean, cooldownSeconds?: number}} [options]
   */
  constructor(code, { allowFailover = false, cooldownSeconds = 0 } = {}) {
    super(code);
    this.name = "EmailProviderDeliveryError";
    this.code = code;
    this.allowFailover = allowFailover;
    this.cooldownSeconds = cooldownSeconds;
  }
}

/** @param {unknown} value @returns {string} */
function required(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {string} text
 * @returns {Record<string, unknown> | null}
 */
function parseJson(text) {
  try {
    const result = JSON.parse(text);
    return result && typeof result === "object" && !Array.isArray(result)
      ? /** @type {Record<string, unknown>} */ (result)
      : null;
  } catch {
    return null;
  }
}

/** @param {string} body @returns {boolean} */
function quotaError(body) {
  return /quota|daily limit|monthly limit|sending limit|credits? exhausted|too many requests|rate.?limit|limit reached|plan limit/i.test(body);
}

/**
 * @param {"sendpulse"|"brevo"|"mailjet"|"mailtrap"|"resend"} provider
 * @param {typeof fetch} fetcher
 * @param {RequestInit} init
 * @returns {Promise<{result: Record<string, unknown> | null, bodyText: string}>}
 */
async function request(provider, fetcher, init) {
  let response;
  try {
    response = await fetcher(ENDPOINTS[provider], {
      ...init,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // A timeout/network failure is ambiguous: the provider may have accepted
    // the email before the connection failed. Never retry on another provider.
    throw new EmailProviderDeliveryError("EMAIL_DELIVERY_STATUS_UNKNOWN");
  }

  const bodyText = await response.text().catch(() => "");
  const result = parseJson(bodyText);
  if (response.ok) return { result, bodyText };

  if (response.status === 401 || response.status === 403) {
    throw new EmailProviderDeliveryError("EMAIL_PROVIDER_CREDENTIAL_REJECTED", {
      allowFailover: true,
      cooldownSeconds: 3600,
    });
  }
  if (response.status === 402 || response.status === 429 || quotaError(bodyText)) {
    const dailyOrMonthly = /daily|monthly|quota|credit|plan limit/i.test(bodyText);
    throw new EmailProviderDeliveryError("EMAIL_PROVIDER_QUOTA_REACHED", {
      allowFailover: true,
      cooldownSeconds: dailyOrMonthly ? 86400 : 3600,
    });
  }
  if (response.status >= 500) {
    throw new EmailProviderDeliveryError("EMAIL_DELIVERY_STATUS_UNKNOWN");
  }
  throw new EmailProviderDeliveryError("EMAIL_PROVIDER_REJECTED_MESSAGE");
}

/**
 * @param {{senderAddress:string,senderName:string}} account
 * @param {{to:string,subject:string,text:string,action?:string}} message
 * @returns {{senderAddress:string,senderName:string,to:string,subject:string,text:string}}
 */
function assertMessage(account, message) {
  const senderAddress = required(account?.senderAddress);
  const senderName = required(account?.senderName);
  const to = required(message?.to);
  const subject = required(message?.subject);
  const text = typeof message?.text === "string" ? message.text : "";
  if (!senderAddress || !senderName || !to || !subject || !text) {
    throw new EmailProviderDeliveryError("EMAIL_PROVIDER_CONFIGURATION_INCOMPLETE");
  }
  return { senderAddress, senderName, to, subject, text };
}

/**
 * @param {Record<string,string>} headers
 * @param {Record<string,unknown>} body
 * @returns {RequestInit}
 */
function jsonInit(headers, body) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

/**
 * Send one authentication email through one configured provider.
 * Credentials are decrypted by the caller and are never returned or logged.
 * Only definite provider rejections (quota or invalid credentials) are
 * eligible for automatic failover. Ambiguous transport/5xx errors are not.
 *
 * @param {"sendpulse"|"brevo"|"mailjet"|"mailtrap"|"resend"} provider
 * @param {Record<string,string>} credentials
 * @param {{senderAddress:string,senderName:string}} account
 * @param {{to:string,subject:string,text:string,action?:string}} message
 * @param {typeof fetch} [fetcher]
 */
export async function sendEmailWithProvider(provider, credentials, account, message, fetcher = fetch) {
  const values = assertMessage(account, message);
  let init;

  if (provider === "sendpulse") {
    const apiKey = required(credentials?.apiKey);
    if (!apiKey) throw new EmailProviderDeliveryError("EMAIL_PROVIDER_CONFIGURATION_INCOMPLETE");
    init = jsonInit({ authorization: "Bearer " + apiKey }, {
      email: {
        text: values.text,
        subject: values.subject,
        from: { name: values.senderName, email: values.senderAddress },
        to: [{ name: "", email: values.to }],
      },
    });
  } else if (provider === "brevo") {
    const apiKey = required(credentials?.apiKey);
    if (!apiKey) throw new EmailProviderDeliveryError("EMAIL_PROVIDER_CONFIGURATION_INCOMPLETE");
    init = jsonInit({ "api-key": apiKey }, {
      sender: { name: values.senderName, email: values.senderAddress },
      to: [{ email: values.to }],
      subject: values.subject,
      textContent: values.text,
      tags: ["sykabelajar-auth", required(message?.action) || "transactional"],
    });
  } else if (provider === "mailjet") {
    const apiKey = required(credentials?.apiKey);
    const apiSecret = required(credentials?.apiSecret);
    if (!apiKey || !apiSecret) throw new EmailProviderDeliveryError("EMAIL_PROVIDER_CONFIGURATION_INCOMPLETE");
    const basic = btoa(apiKey + ":" + apiSecret);
    init = jsonInit({ authorization: "Basic " + basic }, {
      Messages: [{
        From: { Email: values.senderAddress, Name: values.senderName },
        To: [{ Email: values.to }],
        Subject: values.subject,
        TextPart: values.text,
      }],
    });
  } else if (provider === "mailtrap") {
    const apiToken = required(credentials?.apiToken);
    if (!apiToken) throw new EmailProviderDeliveryError("EMAIL_PROVIDER_CONFIGURATION_INCOMPLETE");
    init = jsonInit({ authorization: "Bearer " + apiToken }, {
      from: { email: values.senderAddress, name: values.senderName },
      to: [{ email: values.to }],
      subject: values.subject,
      text: values.text,
      category: required(message?.action) || "transactional",
    });
  } else if (provider === "resend") {
    const apiKey = required(credentials?.apiKey);
    if (!apiKey) throw new EmailProviderDeliveryError("EMAIL_PROVIDER_CONFIGURATION_INCOMPLETE");
    init = jsonInit({ authorization: "Bearer " + apiKey }, {
      from: values.senderName + " <" + values.senderAddress + ">",
      to: [values.to],
      subject: values.subject,
      text: values.text,
    });
  } else {
    throw new EmailProviderDeliveryError("EMAIL_PROVIDER_UNSUPPORTED");
  }

  const { result, bodyText } = await request(provider, fetcher, init);
  if (result && (result.result === false || result.success === false)) {
    if (quotaError(bodyText)) {
      throw new EmailProviderDeliveryError("EMAIL_PROVIDER_QUOTA_REACHED", {
        allowFailover: true,
        cooldownSeconds: 86400,
      });
    }
    throw new EmailProviderDeliveryError("EMAIL_PROVIDER_REJECTED_MESSAGE");
  }

  let messageId = null;
  if (provider === "sendpulse") messageId = typeof result?.id === "string" ? result.id : null;
  if (provider === "brevo") messageId = typeof result?.messageId === "string" ? result.messageId : null;
  if (provider === "resend") messageId = typeof result?.id === "string" ? result.id : null;
  if (provider === "mailtrap") {
    messageId = Array.isArray(result?.message_ids) && typeof result.message_ids[0] === "string"
      ? result.message_ids[0] : null;
  }
  if (provider === "mailjet") {
    const first = Array.isArray(result?.Messages) ? result.Messages[0] : null;
    if (first && first.Status && String(first.Status).toLowerCase() !== "success") {
      throw new EmailProviderDeliveryError("EMAIL_PROVIDER_REJECTED_MESSAGE");
    }
    const firstTo = Array.isArray(first?.To) ? first.To[0] : null;
    messageId = firstTo?.MessageID == null ? null : String(firstTo.MessageID);
  }
  return { messageId };
}
