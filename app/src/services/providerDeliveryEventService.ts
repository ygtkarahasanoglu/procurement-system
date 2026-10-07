import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";

// Provider Delivery & Outcome Confirmation Boundary — RFQ-PD1–RFQ-PD20
// (docs/decisions/ratified.md). Owns: (1) mapping one raw SendGrid
// Event Webhook item onto the ratified, provider-neutral vocabulary
// (RFQ-PD7/RFQ-PD12), and (2) the correlate-then-persist write path
// (RFQ-PD4/RFQ-PD5/RFQ-PD6). Deliberately uses the bare `prisma` client,
// never `tenantScoped()` — see RFQProviderDeliveryEvent's own schema
// comment: a row's tenantId is only known, if at all, AFTER correlation
// resolves inside this module, exactly mirroring rfqDispatchService.ts's
// existing submitSupplierResponse precedent (bare prisma before tenant
// context exists, tenant membership double-checked explicitly).
//
// This module performs NO signature verification and NO HTTP handling —
// server.ts verifies authenticity and supplies already-parsed event
// objects; by the time anything here runs, the webhook is already known
// to be authentic (RFQ-PD15 happens strictly before this).

export const PROVIDER_SENDGRID = "SENDGRID";

const RATIFIED_EVENT_TYPES = new Set(["PROCESSED", "DEFERRED", "DELIVERED", "BOUNCE", "DROPPED"]);

export interface MappedProviderEvent {
  providerEventId: string | null;
  providerMessageId: string | null;
  eventType: "PROCESSED" | "DEFERRED" | "DELIVERED" | "BOUNCE" | "DROPPED";
  providerSubtype: string | null;
  providerEventAt: Date;
  /** Unvalidated candidate dispatch id read from the event's correlation field — never trusted until looked up. */
  rfqDispatchIdCandidate: string | null;
}

const SENDGRID_EVENT_TYPE_MAP: Record<string, MappedProviderEvent["eventType"]> = {
  processed: "PROCESSED",
  deferred: "DEFERRED",
  delivered: "DELIVERED",
  bounce: "BOUNCE",
  dropped: "DROPPED",
};

// Event types current official SendGrid documentation lists that are
// NOT part of the ratified delivery vocabulary (RFQ-PD7) — engagement/
// compliance signals, not delivery facts. Smallest safe behavior,
// explicitly chosen per the implementation brief's own instruction
// (section 11): silently ignored, never force-mapped into a delivery
// state, never persisted. open | click | group_unsubscribe |
// group_resubscribe | spam report | unsubscribe.
function isIgnoredEventType(rawEvent: string): boolean {
  return ["open", "click", "group_unsubscribe", "group_resubscribe", "spamreport", "spam report", "unsubscribe"].includes(rawEvent);
}

// RFQ-PD3/RFQ-PD18: the primary correlation field is
// `custom_args.rfq_dispatch_id`. Current official SendGrid
// documentation's own worked example shows custom_args echoed back as
// FLATTENED top-level keys on the event object (not nested under a
// "custom_args" key) — this is the primary, expected shape. A nested
// `custom_args.rfq_dispatch_id` shape is also checked defensively,
// since full-lifecycle propagation shape has not been empirically
// verified in this environment (RFQ-PD18) and no credentialed test
// exists to confirm it either way. Neither check ever guesses a value —
// absence of both yields `null`, which RFQ-PD5 routes to UNCORRELATED.
function extractRfqDispatchIdCandidate(raw: Record<string, unknown>): string | null {
  const flattened = raw["rfq_dispatch_id"];
  if (typeof flattened === "string" && flattened.length > 0) {
    return flattened;
  }
  const nested = raw["custom_args"];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedValue = (nested as Record<string, unknown>)["rfq_dispatch_id"];
    if (typeof nestedValue === "string" && nestedValue.length > 0) {
      return nestedValue;
    }
  }
  return null;
}

function toOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Maps exactly one item of the Event Webhook's JSON array. Returns
// `null` for an ignored/unsupported event type (RFQ-PD7) or a
// structurally invalid item (missing `event`/`timestamp`) — callers
// must simply skip a `null` result, never fabricate a substitute.
export function mapSendGridEvent(raw: unknown): MappedProviderEvent | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const event = raw as Record<string, unknown>;

  const rawEventType = event["event"];
  const rawTimestamp = event["timestamp"];
  if (typeof rawEventType !== "string" || typeof rawTimestamp !== "number") {
    return null;
  }
  if (isIgnoredEventType(rawEventType)) {
    return null;
  }

  const eventType = SENDGRID_EVENT_TYPE_MAP[rawEventType];
  if (!eventType) {
    // Unrecognized by current mapping — smallest safe behavior is to
    // skip rather than guess (RFQ-PD7's closed vocabulary is never
    // silently widened by an unexpected provider event name).
    return null;
  }

  // RFQ-PD7: SendGrid's `event=bounce`/`type=blocked` becomes
  // eventType=BOUNCE with providerSubtype=BLOCKED — never a top-level
  // BLOCKED event. `type` is only ever read for a bounce. Normalized to
  // uppercase to match this system's own closed-vocabulary convention
  // (PROCESSED/DEFERRED/DELIVERED/BOUNCE/DROPPED are all uppercase) —
  // SendGrid's own `type` value is lowercase ("blocked").
  const providerSubtype = eventType === "BOUNCE" ? toOptionalString(event["type"])?.toUpperCase() ?? null : null;

  return {
    providerEventId: toOptionalString(event["sg_event_id"]),
    providerMessageId: toOptionalString(event["sg_message_id"]),
    eventType,
    providerSubtype,
    providerEventAt: new Date(rawTimestamp * 1000),
    rfqDispatchIdCandidate: extractRfqDispatchIdCandidate(event),
  };
}

// RFQ-PD4/RFQ-PD5/RFQ-PD6: correlate (exact RFQDispatch lookup only —
// never a heuristic fallback), then persist exactly one row. Idempotent
// under (provider, providerEventId) duplication (RFQ-PD6) — a P2002 on
// that unique constraint is caught and treated as "already recorded",
// never surfaced as an error to the webhook caller.
export async function recordProviderDeliveryEvent(mapped: MappedProviderEvent, provider: string = PROVIDER_SENDGRID): Promise<void> {
  if (!RATIFIED_EVENT_TYPES.has(mapped.eventType)) {
    throw new Error(`Internal inconsistency: unrecognized eventType "${mapped.eventType}" reached recordProviderDeliveryEvent.`);
  }

  // RFQ-PD4: tenantId is derived ONLY from the correlated RFQDispatch's
  // own column — never read from the webhook payload itself, which
  // carries no tenant claim this code ever consults.
  let tenantId: string | null = null;
  let rfqDispatchId: string | null = null;
  if (mapped.rfqDispatchIdCandidate) {
    const dispatch = await prisma.rFQDispatch.findUnique({
      where: { id: mapped.rfqDispatchIdCandidate },
      select: { id: true, tenantId: true },
    });
    if (dispatch) {
      tenantId = dispatch.tenantId;
      rfqDispatchId = dispatch.id;
    }
  }
  const correlationState = rfqDispatchId ? "CORRELATED" : "UNCORRELATED";

  try {
    await prisma.rFQProviderDeliveryEvent.create({
      data: {
        provider,
        providerEventId: mapped.providerEventId,
        correlationState,
        tenantId,
        rfqDispatchId,
        eventType: mapped.eventType,
        providerSubtype: mapped.providerSubtype,
        providerEventAt: mapped.providerEventAt,
        providerMessageId: mapped.providerMessageId,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return; // Duplicate (provider, providerEventId) delivery — expected, idempotent no-op.
    }
    throw err;
  }
}
