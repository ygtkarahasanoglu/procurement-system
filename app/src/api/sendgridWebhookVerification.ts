import { createPublicKey, createVerify, type KeyObject } from "node:crypto";

// RFQ-PD15/RFQ-PD16 (docs/decisions/ratified.md) — SendGrid Event
// Webhook authenticity verification. Pure crypto/config primitives only
// (no DB, no domain logic), mirroring rfqResponseToken.ts's own
// precedent for this codebase's "pure primitives module" shape.
//
// Signed content is EXACTLY `timestamp + rawBody` (the timestamp header
// value, concatenated as bytes with the raw, unparsed request body) —
// confirmed by current official SendGrid documentation, which also
// warns that re-serializing the payload before verifying "may remove
// characters that were used as part of the generated signature." The
// caller (server.ts) is responsible for supplying the true raw request
// bytes, captured before any JSON parsing — this module never parses
// JSON itself.

export const SENDGRID_SIGNATURE_HEADER = "X-Twilio-Email-Event-Webhook-Signature";
export const SENDGRID_TIMESTAMP_HEADER = "X-Twilio-Email-Event-Webhook-Timestamp";

// RFQ-PD15: an explicit APPLICATION policy, never a SendGrid-documented
// requirement — current official documentation does not specify a
// replay-tolerance window. Applies to the webhook's own signing
// timestamp (delivery-attempt freshness), never to the age of the
// underlying provider event itself (RFQ-PD9: a DEFERRED event may
// legitimately be reported up to 72h after the original send).
export const REPLAY_TOLERANCE_SECONDS = 300;

// RFQ-PD16: exactly one configured verification key, read lazily (per
// verification attempt, not at module load/startup), mirroring
// sendgridEmailSender.ts's own loadSendGridConfigFromEnv() convention.
// No automated rotation, no multi-key rollover — a missing/invalid key
// is this one verification attempt's own deterministic failure, never
// an application-startup failure.
export function loadWebhookVerificationKeyFromEnv(): string {
  const key = process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY;
  if (!key) {
    throw new Error("SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY is not configured.");
  }
  return key;
}

function toPublicKeyObject(base64DerSpki: string): KeyObject {
  return createPublicKey({ key: Buffer.from(base64DerSpki, "base64"), format: "der", type: "spki" });
}

// ECDSA verification over `timestamp + rawBody`, per RFQ-PD15. Never
// throws on a malformed key/signature/input — any such failure is
// verification failure (fail closed), indistinguishable from a
// genuinely invalid signature, exactly like this codebase's existing
// token/session verification discipline.
export function verifySendGridSignature(params: {
  publicKeyBase64: string;
  signatureBase64: string;
  timestamp: string;
  rawBody: Buffer;
}): boolean {
  try {
    const publicKey = toPublicKeyObject(params.publicKeyBase64);
    const signedPayload = Buffer.concat([Buffer.from(params.timestamp, "utf8"), params.rawBody]);
    const verifier = createVerify("sha256");
    verifier.update(signedPayload);
    verifier.end();
    return verifier.verify(publicKey, params.signatureBase64, "base64");
  } catch {
    return false;
  }
}

// RFQ-PD15: freshness check against the webhook's OWN signing
// timestamp — deliberately independent of, and never substituting for,
// signature verification itself. A non-numeric/missing timestamp is
// never fresh.
export function isSignatureTimestampFresh(
  timestamp: string,
  nowMs: number = Date.now(),
  toleranceSeconds: number = REPLAY_TOLERANCE_SECONDS
): boolean {
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }
  const diffSeconds = Math.abs(nowMs / 1000 - timestampSeconds);
  return diffSeconds <= toleranceSeconds;
}
