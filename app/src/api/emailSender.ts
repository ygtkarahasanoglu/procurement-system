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
}

// Three outcomes, not two — collapsing "timeout/unknown" into either
// success or failure would force sendRFQDispatch to assert a fact it
// does not have, which RFQ-S1 explicitly forbids (a timeout/unknown
// outcome must leave the dispatch SENDING, never SEND_FAILED).
export type SendOutcome =
  | { kind: "success" }
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
