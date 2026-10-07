// Minimal, provider-neutral outbound-email boundary for RFQ SEND
// (RFQ-S1/RFQ-S2, docs/decisions/ratified.md). No provider is selected or
// integrated here — email provider selection remains OPEN
// (docs/decisions/open.md). This interface exists only so
// rfqDispatchService.sendRFQDispatch can depend on "something that sends
// an email" without knowing what that something is.
//
// Deliberately minimal: no retry, no queue, no webhook, no delivery
// tracking, no provider message id, no attachments — none of these are
// required for sendRFQDispatch to be correct, and adding them now would
// be solving a problem this slice does not have.

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;

  // RFQ-PD3/RFQ-PD17 (docs/decisions/ratified.md): an opaque,
  // provider-neutral correlation identifier — in practice always the
  // sending RFQDispatch.id — threaded through so a future inbound
  // provider-delivery webhook can correlate back to it. Deliberately
  // named without any provider vocabulary: this interface must never
  // leak SendGrid-specific concepts (RFQ-PD12). Only the SendGrid
  // adapter (sendgridEmailSender.ts) knows this becomes
  // `custom_args.rfq_dispatch_id`. Optional so every existing caller
  // and test double is unaffected; absent whenever a sender has no
  // correlation use for it.
  correlationId?: string;
}

// Three outcomes, not two — collapsing "timeout/unknown" into either
// success or failure would force sendRFQDispatch to assert a fact it
// does not have, which RFQ-S1 explicitly forbids (a timeout/unknown
// outcome must leave the dispatch SENDING, never SEND_FAILED).
//
// providerMessageId (RFQ-EP4, docs/decisions/ratified.md): an opaque,
// optional correlation identifier a real provider may return on
// acceptance (e.g. SendGrid's X-Message-ID). It is never interpreted by
// Procurement Core, never a delivery-status signal, and never an
// idempotency key (RFQ-EP6) — purely a handle for future
// correlation/forensic use. Absent whenever a provider doesn't supply
// one; this must never be downgraded to failure/unknown on that basis
// alone.
export type SendOutcome =
  | { kind: "success"; providerMessageId?: string }
  | { kind: "failure"; reason: string }
  | { kind: "unknown" };

export interface EmailSender {
  send(input: SendEmailInput): Promise<SendOutcome>;
}

// Composition-root placeholder, mirroring this codebase's own existing
// precedent for an unselected dependency (server.ts's original
// never-really-invoked Authenticator placeholder before a real one was
// chosen). Returns a deterministic, honest "failure" — not "unknown" —
// because the absence of a configured provider is a fact known with full
// certainty, not an ambiguous external outcome. Never wired to any real
// transport; safe to call, intentionally non-functional until a real
// provider decision is made (OPEN, docs/decisions/open.md).
export const unconfiguredEmailSender: EmailSender = {
  async send(): Promise<SendOutcome> {
    return { kind: "failure", reason: "No email provider is configured (provider selection remains OPEN)." };
  },
};
