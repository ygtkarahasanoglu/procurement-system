import type { EmailSender, SendEmailInput, SendOutcome } from "./emailSender";

// Development/demo-only EmailSender (RFQ UI End-to-End V1 milestone).
// Performs NO real network call and selects NO real provider — provider
// selection remains OPEN (docs/decisions/open.md). This module exists
// solely so the composed email (and the response link/raw token it
// contains) can be observed by a human during local development/demo,
// since the production default (unconfiguredEmailSender, emailSender.ts)
// discards it unrecoverably.
//
// Not wired into DEFAULT_SEND_DEPS and not imported by createApp's own
// module-level composition root by default — it is reachable only
// through an explicit, separate, opt-in call (see server.ts's
// RFQ_DEV_EMAIL_CAPTURE-gated branch). createApp's default behavior
// (DEFAULT_SEND_DEPS / unconfiguredEmailSender) is completely unchanged.
//
// Deliberately performs no logging of its own inside send() — the raw
// token (embedded in `body`) must never flow through this codebase's
// shared, general-purpose error-reporting output (used elsewhere in
// server.ts). Capture is purely in-memory, retrievable only via the
// accessors returned below, plus an optional caller-supplied onCapture
// callback for a deliberately separate, explicitly dev-only, opt-in
// output path.
export interface CapturedEmail extends SendEmailInput {
  capturedAt: Date;
}

export function createDevEmailSender(onCapture?: (email: CapturedEmail) => void) {
  const captured: CapturedEmail[] = [];

  const sender: EmailSender = {
    async send(input: SendEmailInput): Promise<SendOutcome> {
      const email: CapturedEmail = { ...input, capturedAt: new Date() };
      captured.push(email);
      onCapture?.(email);
      return { kind: "success" };
    },
  };

  return {
    sender,
    getCapturedEmails: (): readonly CapturedEmail[] => captured,
    getLastEmailFor: (to: string): CapturedEmail | undefined => [...captured].reverse().find((e) => e.to === to),
  };
}
