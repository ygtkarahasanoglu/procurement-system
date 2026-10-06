// Pure RFQ SEND email composition — no Prisma, no authorization, no
// state mutation, no EmailSender dependency. Mirrors rfqResponseToken.ts's
// own module-boundary discipline (pure in, pure out) one layer up the
// stack: that module turns randomness into a token; this one turns an
// already-validated data bundle into email text.
//
// supplierEmail is typed as a plain `string`, not `string | null` —
// sendRFQDispatch's own deterministic preflight (RFQ SEND implementation
// design) already guarantees non-null before this is ever called, so a
// missing email is unrepresentable at this boundary rather than merely
// unchecked at runtime.
//
// The email is a presentation artifact only — never evidence, never a
// PersistedClaim (R11), never decision-bearing commercial content. Plain
// text, deliberately: no HTML means no HTML-injection class at all, and
// nothing here needs a templating engine.

export interface RfqEmailData {
  supplierEmail: string;
  supplierName: string;
  productName: string;
  requestedQuantity: string;
  unit: string;
  responseUrl: string;
}

export interface ComposedEmail {
  to: string;
  subject: string;
  body: string;
}

// Email subjects are header-adjacent even when passed through a
// structured provider API — a raw CR/LF embedded in a stored, untrusted
// string (Supplier.name/Product.name have no format validation anywhere
// in domain/validation.ts) must never reach the subject line. Stripping
// here is defense-in-depth at the one layer this code fully controls;
// it does not assume anything about how a future EmailSender
// implementation itself handles header safety.
function sanitizeForSubject(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

// Uses the URL class rather than string concatenation, so a malformed
// base is rejected loudly (throws) instead of producing a silently
// broken or unsafe link, and the raw token is percent-encoded like any
// other untrusted path segment even though it is already hex (harmless,
// correct defensive practice, not a sign anything is actually unsafe
// about the token's own charset).
export function buildResponseUrl(baseUrl: string, rawToken: string): string {
  return new URL(`/rfq-response/${encodeURIComponent(rawToken)}`, baseUrl).toString();
}

export function composeRfqEmail(data: RfqEmailData): ComposedEmail {
  const subject = `Request for Quote: ${sanitizeForSubject(data.productName)}`;

  const body = [
    `Hello ${data.supplierName},`,
    "",
    `We would like to request a quote for the following:`,
    "",
    `Product: ${data.productName}`,
    `Quantity: ${data.requestedQuantity} ${data.unit}`,
    "",
    `Please respond using the link below:`,
    data.responseUrl,
  ].join("\n");

  return { to: data.supplierEmail, subject, body };
}
