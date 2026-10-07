import type { EmailSender, SendEmailInput, SendOutcome } from "./emailSender";

// RFQ-EP1/EP2 (docs/decisions/ratified.md): Twilio SendGrid, EU region.
// Hardcoded, not env-configurable, and never falls back to the global
// endpoint — RFQ-EP2/EP3's EU-only deployment requirement means an
// env-overridable value would itself be the exact risk this constant
// exists to remove. No `on-behalf-of` header is used (confirmed
// unsupported by the Mail Send API) — the EU subuser's identity is
// carried entirely by which API key is used, not by any request field.
const SENDGRID_EU_MAIL_SEND_URL = "https://api.eu.sendgrid.com/v3/mail/send";

// Conservative, implementation-level only — not a generic timeout
// framework, not persisted, not a domain concept. A timeout here maps to
// `unknown` (RFQ-S1/RFQ-RT2), exactly like any other unresolved external
// outcome; it never becomes SEND_FAILED.
const REQUEST_TIMEOUT_MS = 10_000;

interface SendGridConfig {
  apiKey: string;
  fromEmail: string;
}

// Mirrors authRoutes.ts's loadOidcConfigFromEnv() convention exactly:
// read lazily, at send time, not at module load or application startup.
// A missing value is this one send attempt's own deterministic failure
// (see send() below) — it is not an application-startup failure.
function loadSendGridConfigFromEnv(): SendGridConfig {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    throw new Error("SendGrid configuration is incomplete: SENDGRID_API_KEY and SENDGRID_FROM_EMAIL must both be set.");
  }
  return { apiKey, fromEmail };
}

// Maps the already-composed SendEmailInput directly onto SendGrid's v3
// Mail Send request shape. Deliberately does not reinterpret or
// reconstruct any RFQ-specific content — rfqEmailComposer.ts already
// produced the final to/subject/body; this is a pure transport mapping.
// text/plain only, matching the existing composer's own plain-text-only
// discipline (no HTML introduced here).
function buildRequestBody(config: SendGridConfig, input: SendEmailInput): string {
  return JSON.stringify({
    personalizations: [{ to: [{ email: input.to }] }],
    from: { email: config.fromEmail },
    subject: input.subject,
    content: [{ type: "text/plain", value: input.body }],
  });
}

// Extracts a safe, non-echoing error description from SendGrid's
// documented error shape ({errors: [{message, field, help}]}) for
// logging only. Never logs the raw response body verbatim — a
// defensive choice against the (unlikely but possible) case of a
// provider error payload echoing request content back.
async function extractSafeErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { errors?: Array<{ message?: string }> };
    const message = body.errors?.[0]?.message;
    return typeof message === "string" ? message.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

// RFQ-EP1/EP5 (docs/decisions/ratified.md): the real, EU-region SendGrid
// EmailSender implementation. All provider-specific status codes, error
// shapes, and header names are handled exclusively inside this module —
// nothing outside it (rfqDispatchService.ts, routes, UI) ever sees a
// SendGrid-shaped value; everything crossing the EmailSender boundary is
// exactly one of success/failure/unknown (SendOutcome), per RFQ-S1.
export const sendGridEmailSender: EmailSender = {
  async send(input: SendEmailInput): Promise<SendOutcome> {
    const startedAt = Date.now();

    let config: SendGridConfig;
    try {
      config = loadSendGridConfigFromEnv();
    } catch (err) {
      console.error("[sendgrid] configuration error:", err instanceof Error ? err.message : String(err));
      return { kind: "failure", reason: "Email provider is not configured." };
    }

    let response: Response;
    try {
      response = await fetch(SENDGRID_EU_MAIL_SEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: buildRequestBody(config, input),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Any transport-level rejection — timeout/AbortError, DNS failure,
      // connection reset, network loss — is, by definition, a case where
      // this system never received a definitive provider response.
      // RFQ-RT2: must never be classified as a deterministic failure.
      const duration = Date.now() - startedAt;
      console.error(
        `[sendgrid] transport error after ${duration}ms, treated as unknown:`,
        err instanceof Error ? err.message : String(err)
      );
      return { kind: "unknown" };
    }

    const duration = Date.now() - startedAt;

    if (response.status === 202) {
      // Headers.get() is case-insensitive per the Fetch spec — no manual
      // normalization needed. Confirmed present on 202 per SendGrid's own
      // documentation (used for later Event Webhook correlation,
      // RFQ-EP4) but never required: absence must not downgrade this
      // outcome.
      const providerMessageId = response.headers.get("X-Message-Id") ?? undefined;
      console.log(`[sendgrid] accepted in ${duration}ms${providerMessageId ? ` providerMessageId=${providerMessageId}` : ""}`);
      return { kind: "success", providerMessageId };
    }

    if (response.status === 429) {
      // RFQ-RT2: a 429 is a real, received, deterministic provider
      // response (the provider explicitly declined this request) — not
      // an ambiguous transport outcome. Retryable via the EXISTING
      // RFQ-RT3 same-dispatch retry mechanism; no automatic retry here.
      console.error(`[sendgrid] rate limited (429) after ${duration}ms`);
      return { kind: "failure", reason: "Email provider rate-limited this request." };
    }

    if (response.status === 401 || response.status === 403) {
      // Distinctly loud: an auth/config failure is systemic, not an
      // ordinary per-message rejection — must not look identical to a
      // routine 400/413 in the logs.
      console.error(
        `[sendgrid] SYSTEMIC AUTH/CONFIG FAILURE — HTTP ${response.status} after ${duration}ms. ` +
          `Check SENDGRID_API_KEY validity/scope — this is not an ordinary message rejection.`
      );
      return { kind: "failure", reason: "Email provider rejected the request (authentication/authorization)." };
    }

    if (response.status === 400 || response.status === 413) {
      const detail = await extractSafeErrorMessage(response);
      console.error(`[sendgrid] deterministic rejection — HTTP ${response.status} after ${duration}ms${detail ? `: ${detail}` : ""}`);
      return { kind: "failure", reason: `Email provider rejected the request (HTTP ${response.status}).` };
    }

    if (response.status >= 500) {
      console.error(`[sendgrid] provider server error (treated as unknown) — HTTP ${response.status} after ${duration}ms`);
      return { kind: "unknown" };
    }

    // Any other, unrecognized status is treated conservatively as
    // unknown rather than guessed at as success or failure — this
    // adapter only asserts failure for the deterministic codes
    // explicitly handled above. Do not classify a transport/response
    // ambiguity as a deterministic failure.
    console.error(`[sendgrid] unrecognized response status (treated as unknown): ${response.status} after ${duration}ms`);
    return { kind: "unknown" };
  },
};
