import type { EmailSender, SendEmailInput, SendOutcome } from "../../src/api/emailSender";

// Test-only EmailSender, mirroring testAuthenticator.ts's own convention
// exactly: a dedicated, controllable test double that performs no real
// transport of any kind. MUST NEVER be imported from app/src/, and must
// never be wired into server.ts's own (production/dev) composition root
// — it lives under app/test/ specifically so it is never reachable from
// that path.
//
// Records every call for assertion, and returns a single configurable
// outcome for every send() — set it per-test via setNextOutcome before
// calling sendRFQDispatch.
export class FakeEmailSender implements EmailSender {
  readonly calls: SendEmailInput[] = [];
  private nextOutcome: SendOutcome = { kind: "success" };

  setNextOutcome(outcome: SendOutcome): void {
    this.nextOutcome = outcome;
  }

  async send(input: SendEmailInput): Promise<SendOutcome> {
    this.calls.push(input);
    return this.nextOutcome;
  }
}
