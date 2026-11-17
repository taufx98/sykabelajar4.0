const ENDPOINTS = {
  sendpulse: "https://api.sendpulse.com/smtp/emails",
  brevo: "https://api.brevo.com/v3/smtp/email",
  mailjet: "https://api.mailjet.com/v3.1/send",
  mailtrap: "https://send.api.mailtrap.io/api/send",
  resend: "https://api.resend.com/emails",
};



const CUSTOM_PLACEHOLDERS = new Set(["from.email", "from.name", "to", "subject", "text", "action"]);
const FORBIDDEN_CUSTOM_HEADERS = new Set([
  "authorization", "connection", "content-length", "content-type", "cookie",
  "host", "origin", "referer", "set-cookie", "transfer-encoding", "upgrade",
]);
const DEFAULT_CUSTOM_PAYLOAD = JSON.stringify({
  from: { email: "{{from.email}}", name: "{{from.name}}" },
  to: [{ email: "{{to}}" }],
  subject: "{{subject}}",
  text: "{{text}}",
  action: "{{action}}",
}, null, 2);

/** @param {string} value @returns {string} */
function safeCustomEndpoint(value) {
  let url;
  try { url = new URL(required(value)); } catch { throw new Error("EMAIL_CUSTOM_ENDPOINT_INVALID"); }
  const host = url.hostname.toLowerCase();
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
  const blockedSuffixes = [".localhost", ".local", ".internal", ".lan", ".home", ".home.arpa", ".test", ".invalid", ".example"];
  if (
    url.protocol !== "https:" || !host.includes(".") || host.endsWith(".") ||
    host.includes(":") || host.includes("[") || ipv4 ||
    host === "localhost" || blockedSuffixes.some((suffix) => host.endsWith(suffix)) ||
    url.username || url.password || url.search || url.hash ||
    (url.port && url.port !== "443")
  ) throw new Error("EMAIL_CUSTOM_ENDPOINT_INVALID");
  return url.toString();
}

/** @param {string} value @returns {boolean} */
function safeCustomHeaderName(value) {
  return /^[!#$%&'*+.^_|~0-9A-Za-z-]{1,80}$/.test(value) &&
    !FORBIDDEN_CUSTOM_HEADERS.has(value.toLowerCase());
}

/** @param {string} value @returns {Record<string, unknown>} */
function parseCustomPayloadTemplate(value) {
  if (value.length > 12000) throw new Error("EMAIL_CUSTOM_PAYLOAD_INVALID");
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error("EMAIL_CUSTOM_PAYLOAD_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("EMAIL_CUSTOM_PAYLOAD_INVALID");
  }
  /** @type {Set<string>} */
  const used = new Set();
  /** @param {unknown} item @param {number} depth @returns {void} */
  function visit(item, depth) {
    if (depth > 8) throw new Error("EMAIL_CUSTOM_PAYLOAD_INVALID");
    if (typeof item === "string") {
      const tokens = item.match(/\{\{[^{}]+\}\}/g) ?? [];
      for (const token of tokens) {
        const name = token.slice(2, -2).trim();
        if (!CUSTOM_PLACEHOLDERS.has(name)) throw new Error("EMAIL_CUSTOM_PAYLOAD_INVALID");
        used.add(name);
      }
      if (item.includes("{{") && tokens.length === 0) throw new Error("EMAIL_CUSTOM_PAYLOAD_INVALID");
      return;
    }
    if (Array.isArray(item)) {
      if (item.length > 100) throw new Error("EMAIL_CUSTOM_PAYLOAD_INVALID");
      item.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (item && typeof item === "object") {
      for (const [key, entry] of Object.entries(item)) {
        if (/authorization|api.?key|secret|password|credential|access.?token/i.test(key)) {
          throw new Error("EMAIL_CUSTOM_PAYLOAD_INVALID");
        }
        visit(entry, depth + 1);
      }
      return;
    }
    if (item !== null && !["number", "boolean"].includes(typeof item)) {
      throw new Error("EMAIL_CUSTOM_PAYLOAD_INVALID");
    }
  }
  visit(parsed, 0);
  for (const requiredToken of ["to", "subject", "text"]) {
    if (!used.has(requiredToken)) throw new Error("EMAIL_CUSTOM_PAYLOAD_INVALID");
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * Validate the custom JSON HTTP adapter. The returned object is encrypted
 * as a single bundle by the caller; it is never exposed by the Admin GET API.
 * @param {Record<string, string>} input
 * @returns {Record<string, string>}
 */
export function normalizeCustomHttpConfig(input) {
  const endpointUrl = safeCustomEndpoint(input.endpointUrl);
  const authMode = required(input.authMode) || "bearer";
  if (!["none", "bearer", "api_key", "basic"].includes(authMode)) {
    throw new Error("EMAIL_CUSTOM_AUTH_INVALID");
  }
  const authHeaderName = required(input.authHeaderName) || "X-API-Key";
  const authPrefix = required(input.authPrefix);
  if ((authMode === "api_key" && !safeCustomHeaderName(authHeaderName)) ||
      authPrefix.length > 32 || /[\r\n]/.test(authPrefix)) {
    throw new Error("EMAIL_CUSTOM_AUTH_INVALID");
  }

  const apiKey = required(input.apiKey);
  const username = required(input.username);
  const password = required(input.password);
  if ((authMode === "bearer" || authMode === "api_key") &&
      (apiKey.length < 16 || apiKey.length > 4096)) {
    throw new Error("EMAIL_CUSTOM_CREDENTIAL_REQUIRED");
  }
  if (authMode === "basic" &&
      (!username || username.length > 512 || password.length < 8 || password.length > 4096)) {
    throw new Error("EMAIL_CUSTOM_CREDENTIAL_REQUIRED");
  }

  const extraHeadersJson = required(input.extraHeadersJson) || "{}";
  let extraHeaders;
  try { extraHeaders = JSON.parse(extraHeadersJson); } catch {
    throw new Error("EMAIL_CUSTOM_HEADERS_INVALID");
  }
  if (!extraHeaders || typeof extraHeaders !== "object" || Array.isArray(extraHeaders) ||
      Object.keys(extraHeaders).length > 16) {
    throw new Error("EMAIL_CUSTOM_HEADERS_INVALID");
  }
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (!safeCustomHeaderName(name) || typeof value !== "string" ||
        value.length > 1024 || /[\r\n]/.test(value)) {
      throw new Error("EMAIL_CUSTOM_HEADERS_INVALID");
    }
  }

  const payloadTemplateJson = required(input.payloadTemplateJson) || DEFAULT_CUSTOM_PAYLOAD;
  parseCustomPayloadTemplate(payloadTemplateJson);
  return {
    endpointUrl, authMode, authHeaderName, authPrefix, apiKey,
    username, password, extraHeadersJson: JSON.stringify(extraHeaders), payloadTemplateJson,
  };
}

/** @param {unknown} value @param {Record<string, string>} replacements @returns {unknown} */
function replaceCustomTokens(value, replacements) {
  if (typeof value === "string") {
    const exact = /^\{\{([^{}]+)\}\}$/.exec(value);
    if (exact) return replacements[exact[1].trim()] ?? "";
    return value.replace(/\{\{([^{}]+)\}\}/g, (_match, key) => replacements[String(key).trim()] ?? "");
  }
  if (Array.isArray(value)) return value.map((item) => replaceCustomTokens(item, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, replaceCustomTokens(item, replacements),
    ]));
  }
  return value;
}

/**
 * @param {Record<string, string>} credentials
 * @param {{senderAddress:string,senderName:string,to:string,subject:string,text:string}} values
 * @param {{action?:string}} message
 * @returns {{endpoint:string,init:RequestInit}}
 */
function buildCustomHttpRequest(credentials, values, message) {
  const config = normalizeCustomHttpConfig(credentials);
  const headers = JSON.parse(config.extraHeadersJson);
  if (config.authMode === "bearer") headers.authorization = "Bearer " + config.apiKey;
  if (config.authMode === "api_key") {
    headers[config.authHeaderName] = config.authPrefix
      ? config.authPrefix + " " + config.apiKey
      : config.apiKey;
  }
  if (config.authMode === "basic") {
    headers.authorization = "Basic " + btoa(config.username + ":" + config.password);
  }
  const template = parseCustomPayloadTemplate(config.payloadTemplateJson);
  const body = replaceCustomTokens(template, {
    "from.email": values.senderAddress,
    "from.name": values.senderName,
    to: values.to,
    subject: values.subject,
    text: values.text,
    action: required(message?.action) || "transactional",
  });
  return {
    endpoint: config.endpointUrl,
    init: jsonInit(headers, /** @type {Record<string, unknown>} */ (body)),
  };
}

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
 * @param {"sendpulse"|"brevo"|"mailjet"|"mailtrap"|"resend"|"custom_http"} provider
 * @param {typeof fetch} fetcher
 * @param {string} endpoint
 * @param {RequestInit} init
 * @returns {Promise<{result: Record<string, unknown> | null, bodyText: string}>}
 */
async function request(provider, fetcher, endpoint, init) {
  let response;
  try {
    // SendPulse can take longer to accept SMTP queue requests than the other
    // providers. Keep the timeout bounded, but do not abort it after 8 seconds.
    const timeoutMs = provider === "sendpulse" ? 20000 : 8000;
    response = await fetcher(endpoint, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // A timeout/network failure is ambiguous: the provider may have accepted
    // the email before the connection failed. Never retry on another provider.
    const timedOut = error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new EmailProviderDeliveryError(
      timedOut ? "EMAIL_PROVIDER_TIMEOUT" : "EMAIL_PROVIDER_NETWORK_ERROR",
    );
  }

  let bodyText;
  try {
    bodyText = await response.text();
  } catch {
    // The request may already have been accepted even if its response body
    // could not be read. Keep this outcome non-retryable.
    throw new EmailProviderDeliveryError("EMAIL_PROVIDER_RESPONSE_READ_FAILED");
  }
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
    // A provider 5xx may occur after queue acceptance; keep it non-retryable.
    throw new EmailProviderDeliveryError("EMAIL_PROVIDER_HTTP_5XX");
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

/** Escape plain-text content before embedding it in SendPulse's HTML field. */
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

/** Encode UTF-8 bytes to Base64 without corrupting non-ASCII email content. */
function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function buildSendPulseHtml(text) {
  const safeLines = text.split(/\r\n|\n|\r/).map(escapeHtml);
  const html = "<!doctype html><html><body><div>" +
    safeLines.join("<br>") +
    "</div></body></html>";
  return base64Utf8(html);
}

/**
 * Send one authentication email through one configured provider.
 * Credentials are decrypted by the caller and are never returned or logged.
 * Only definite provider rejections (quota or invalid credentials) are
 * eligible for automatic failover. Ambiguous transport/5xx errors are not.
 *
 * @param {"sendpulse"|"brevo"|"mailjet"|"mailtrap"|"resend"|"custom_http"} provider
 * @param {Record<string,string>} credentials
 * @param {{senderAddress:string,senderName:string}} account
 * @param {{to:string,subject:string,text:string,action?:string}} message
 * @param {typeof fetch} [fetcher]
 */
export async function sendEmailWithProvider(provider, credentials, account, message, fetcher = fetch) {
  const values = assertMessage(account, message);
  let init;
  let endpoint = provider === "custom_http" ? "" : ENDPOINTS[provider];

  if (provider === "custom_http") {
    try {
      const custom = buildCustomHttpRequest(credentials, values, message);
      endpoint = custom.endpoint;
      init = custom.init;
    } catch (error) {
      throw new EmailProviderDeliveryError(error instanceof Error ? error.message : "EMAIL_PROVIDER_CONFIGURATION_INCOMPLETE");
    }
  } else if (provider === "sendpulse") {
    const apiKey = required(credentials?.apiKey);
    if (!apiKey) throw new EmailProviderDeliveryError("EMAIL_PROVIDER_CONFIGURATION_INCOMPLETE");
    init = jsonInit({ authorization: "Bearer " + apiKey }, {
      email: {
        // SendPulse's SMTP API documents Base64-encoded HTML alongside the
        // plain-text alternative for a custom email body.
        html: buildSendPulseHtml(values.text),
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

  const { result, bodyText } = await request(provider, fetcher, endpoint, init);
  if (result && (result.result === false || result.success === false)) {
    if (quotaError(bodyText)) {
      throw new EmailProviderDeliveryError("EMAIL_PROVIDER_QUOTA_REACHED", {
        allowFailover: true,
        cooldownSeconds: 86400,
      });
    }
    throw new EmailProviderDeliveryError("EMAIL_PROVIDER_REJECTED_MESSAGE");
  }

  // A 2xx without the documented SendPulse success flag and message ID is
  // not sufficient proof of acceptance. Do not report success or auto-retry.
  if (provider === "sendpulse" &&
      (result?.result !== true || typeof result.id !== "string" || !result.id.trim())) {
    throw new EmailProviderDeliveryError("EMAIL_PROVIDER_RESPONSE_INVALID");
  }

  let messageId = null;
  if (provider === "sendpulse") messageId = typeof result?.id === "string" ? result.id : null;
  if (provider === "brevo") messageId = typeof result?.messageId === "string" ? result.messageId : null;
  if (provider === "resend") messageId = typeof result?.id === "string" ? result.id : null;
  if (provider === "mailtrap") {
    messageId = Array.isArray(result?.message_ids) && typeof result.message_ids[0] === "string"
      ? result.message_ids[0] : null;
  }
  if (provider === "custom_http") {
    if (typeof result?.id === "string") messageId = result.id;
    else if (typeof result?.messageId === "string") messageId = result.messageId;
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
