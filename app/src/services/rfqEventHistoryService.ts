// RFQ-EH1–RFQ-EH10 (docs/decisions/ratified.md): recording for the one,
// narrow, RFQ-scoped historical record — never a universal AuditLog,
// never a generic event store, never SendAttempt. This module owns the
// write shape for all three closed event types (RFQ-EH2); callers never
// construct a `data` object for RFQCommunicationEvent themselves.
//
// Deliberately accepts whatever already-tenant-scoped client the caller
// already holds (a `tenantScoped()` client, or a `tx` inside one of its
// `$transaction` callbacks) rather than deriving tenant scope itself —
// this module is a pure write-shape helper, not a second place tenant
// enforcement happens. The parameter type below is intentionally a
// minimal structural shape (not the full Prisma client type) so it
// accepts either kind of caller-supplied client without extra casting.
interface RfqEventHistoryWriter {
  rFQCommunicationEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

type RfqEventActorSource = "INTERNAL_USER" | "SYSTEM" | "SUPPLIER" | "PROVIDER";
type RfqEventSendOutcome = "ACCEPTED" | "FAILED" | "UNKNOWN";

// RFQ-EH2/RFQ-EH6/RFQ-EH10: DISPATCH_CREATED is paired with RFQDispatch
// creation in the SAME local transaction. This function deliberately
// does NOT catch its own errors — a failure here must propagate and
// abort that transaction (no external, irreversible side effect has
// occurred yet at creation time, so full-transaction rollback is safe
// and correct, unlike the SEND_ATTEMPT_RESULT case below).
export async function recordDispatchCreatedEvent(
  db: RfqEventHistoryWriter,
  input: { tenantId: string; rfqDispatchId: string; actorSource: RfqEventActorSource; actorUserId?: string | null }
): Promise<void> {
  await db.rFQCommunicationEvent.create({
    data: {
      tenantId: input.tenantId,
      rfqDispatchId: input.rfqDispatchId,
      eventType: "DISPATCH_CREATED",
      actorSource: input.actorSource,
      actorUserId: input.actorUserId ?? null,
    },
  });
}

// RFQ-EH2 item 3/RFQ-EH4/RFQ-EH10 point 10: paired with the existing
// RFQ-R4 token-consumption + QuoteVersion-creation transaction, in the
// same local transaction, unchanged by RFQ-EH10. No supplier-submitted
// commercial content is accepted here — only the already-created
// QuoteVersion's own id is referenced. Deliberately does not catch its
// own errors, for the same reason as recordDispatchCreatedEvent above:
// nothing externally irreversible has happened in this flow either.
export async function recordSupplierResponseReceivedEvent(
  db: RfqEventHistoryWriter,
  input: { tenantId: string; rfqDispatchId: string; quoteVersionId: string }
): Promise<void> {
  await db.rFQCommunicationEvent.create({
    data: {
      tenantId: input.tenantId,
      rfqDispatchId: input.rfqDispatchId,
      eventType: "SUPPLIER_RESPONSE_RECEIVED",
      actorSource: "SUPPLIER",
      quoteVersionId: input.quoteVersionId,
    },
  });
}

// RFQ-EH10 — the one case where this module's discipline is the exact
// opposite of the two functions above. The RFQDispatch current-state
// transition (or, for UNKNOWN, the deliberate absence of one) has
// already been determined to be correct by the time this is called;
// per RFQ-EH10 point 4, the event-insertion attempt is mandatory, but
// its success/failure must never affect that already-correct state.
// This function therefore NEVER throws — any failure is caught and
// logged right here. This is the one legitimate place in the RFQ
// codebase this discipline belongs: rfqDispatchService.ts itself
// carries its own, separate, pre-existing "never logs anything"
// invariant (see supplierResponse.test.ts), so logging a SEND_ATTEMPT_RESULT
// recording failure cannot happen there — it happens in this module
// instead, which has no such restriction.
//
// Never logs the response token, the raw RFQ email body, or any raw
// provider response — only the dispatch id and the outcome label,
// neither of which is sensitive.
export async function recordSendAttemptResultEvent(
  db: RfqEventHistoryWriter,
  input: {
    tenantId: string;
    rfqDispatchId: string;
    actorUserId: string;
    outcome: RfqEventSendOutcome;
    providerMessageId?: string | null;
  }
): Promise<void> {
  try {
    await db.rFQCommunicationEvent.create({
      data: {
        tenantId: input.tenantId,
        rfqDispatchId: input.rfqDispatchId,
        eventType: "SEND_ATTEMPT_RESULT",
        actorSource: "INTERNAL_USER",
        actorUserId: input.actorUserId,
        outcome: input.outcome,
        // RFQ-EH5: providerMessageId only ever recorded alongside ACCEPTED.
        providerMessageId: input.outcome === "ACCEPTED" ? input.providerMessageId ?? null : null,
      },
    });
  } catch (err) {
    console.error(
      `[rfq-event-history] failed to record SEND_ATTEMPT_RESULT (outcome=${input.outcome}) for dispatch ${input.rfqDispatchId}:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}
