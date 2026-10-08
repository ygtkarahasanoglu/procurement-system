import { createHash } from "node:crypto";
import { tenantScoped, prisma } from "../db/client";
import { NotFoundError, InvalidStateError, ValidationError } from "../domain/errors";
import { assertActorAuthorized } from "../domain/authorization";
import {
  requireId,
  requireNonEmptyString,
  requirePositiveDecimal,
  requireUnit,
  requireCurrency,
  requireOptionalPositiveInt,
  requireOptionalIsoDate,
  requireOptionalBoundedString,
} from "../domain/validation";
import { hashToken } from "../api/rfqResponseToken";
import { submitQuote, type SubmitQuoteInput } from "./quoteService";
import { recordSupplierResponseReceivedEvent } from "./rfqEventHistoryService";
import type { QuoteExtractionProvider, ExtractedQuote } from "./quoteExtractionProvider";

// AI-1 (docs/decisions/ratified.md): CapturedEvidence intake + AI
// Extraction orchestration. This module never creates a QuoteVersion
// itself on upload — only confirmExtraction (human Validation) does, via
// the existing quoteService.submitQuote (R12: "confidence never
// substitutes for evidence").

export interface QuoteDocumentServiceDeps {
  provider: QuoteExtractionProvider;
}

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

function decodeAndValidateFile(
  fileName: unknown,
  mimeType: unknown,
  base64: unknown
): { fileName: string; mimeType: string; content: Buffer } {
  const validFileName = requireNonEmptyString(fileName, "fileName");
  const validMimeType = requireNonEmptyString(mimeType, "mimeType");
  if (!ALLOWED_MIME_TYPES.has(validMimeType)) {
    throw new ValidationError(`mimeType must be one of: ${[...ALLOWED_MIME_TYPES].join(", ")} (got: ${validMimeType}).`);
  }
  const validBase64 = requireNonEmptyString(base64, "base64");
  const content = Buffer.from(validBase64, "base64");
  if (content.length === 0 || content.length > MAX_SIZE_BYTES) {
    throw new ValidationError(`File must be between 1 byte and ${MAX_SIZE_BYTES} bytes (got: ${content.length} bytes).`);
  }
  return { fileName: validFileName, mimeType: validMimeType, content };
}

// Our own validation of the provider's output (never trusted as-is,
// regardless of provider or declared confidence — R12). Invalid shape of
// any kind fails the WHOLE extraction — never a partial quote.
function validateExtractedQuote(raw: unknown): ExtractedQuote {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("Extraction result must be an object.");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.lines) || obj.lines.length === 0) {
    throw new ValidationError("Extraction result must contain at least one line.");
  }
  const lines = obj.lines.map((line, i) => {
    if (line === null || typeof line !== "object" || Array.isArray(line)) {
      throw new ValidationError(`Extraction result line ${i} must be an object.`);
    }
    const l = line as Record<string, unknown>;
    return {
      description: requireNonEmptyString(l.description, `line ${i} description`),
      quantity: requirePositiveDecimal(l.quantity, `line ${i} quantity`),
      unit: requireUnit(l.unit),
      unitPrice: requirePositiveDecimal(l.unitPrice, `line ${i} unitPrice`),
      currency: requireCurrency(l.currency),
    };
  });
  return {
    lines,
    leadTimeDays: requireOptionalPositiveInt(obj.leadTimeDays, "leadTimeDays"),
    paymentTermDays: requireOptionalPositiveInt(obj.paymentTermDays, "paymentTermDays"),
    validUntil: requireOptionalIsoDate(obj.validUntil, "validUntil")?.toISOString(),
    incoterm: requireOptionalBoundedString(obj.incoterm, "incoterm", 16),
  };
}

// Shared by both entry paths (buyer upload, supplier-link upload) — runs
// the configured provider, validates its output with our own code, and
// persists exactly one QuoteExtraction row: PENDING_REVIEW on success,
// FAILED on ANY failure (provider not configured, provider error,
// invalid output). Never throws — a failure here is always recorded as
// data, never an uncaught exception.
async function runExtractionAndSave(
  db: ReturnType<typeof tenantScoped>,
  provider: QuoteExtractionProvider,
  document: { id: string; tenantId: string; fileName: string; mimeType: string; content: Buffer },
  requested: { requestedProduct: string; requestedQuantity: string; requestedUnit: string }
) {
  try {
    const { provider: providerName, model, result } = await provider.extract({
      fileName: document.fileName,
      mimeType: document.mimeType,
      content: document.content,
      ...requested,
    });
    const validated = validateExtractedQuote(result);
    return db.quoteExtraction.create({
      data: {
        tenantId: document.tenantId,
        quoteDocumentId: document.id,
        provider: providerName,
        model,
        status: "PENDING_REVIEW",
        extracted: validated,
      },
    });
  } catch (err) {
    return db.quoteExtraction.create({
      data: {
        tenantId: document.tenantId,
        quoteDocumentId: document.id,
        provider: provider.name,
        model: "unknown",
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : "AI extraction failed.",
      },
    });
  }
}

export interface UploadQuoteDocumentInput {
  sourcingEventId: string;
  supplierId: string;
  fileName: string;
  mimeType: string;
  base64: string;
}

// Buyer entry path (AI-1 item 1a). Actor must be procurement_user.
export async function uploadQuoteDocument(
  tenantId: string,
  actorUserId: string,
  input: UploadQuoteDocumentInput,
  deps: QuoteDocumentServiceDeps
) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validActorUserId = requireId(actorUserId, "actorUserId");
  await assertActorAuthorized(validTenantId, validActorUserId, ["procurement_user"]);

  if (input === null || typeof input !== "object") {
    throw new ValidationError("Request body must be an object.");
  }
  const validSourcingEventId = requireId(input.sourcingEventId, "sourcingEventId");
  const validSupplierId = requireId(input.supplierId, "supplierId");
  const { fileName, mimeType, content } = decodeAndValidateFile(input.fileName, input.mimeType, input.base64);

  const db = tenantScoped(validTenantId);

  const sourcingEvent = await db.sourcingEvent.findFirst({
    where: { id: validSourcingEventId, tenantId: validTenantId },
    include: { requestLine: { include: { product: true } } },
  });
  if (!sourcingEvent) {
    throw new NotFoundError("SourcingEvent", validSourcingEventId);
  }
  const supplier = await db.supplier.findFirst({ where: { id: validSupplierId, tenantId: validTenantId } });
  if (!supplier) {
    throw new NotFoundError("Supplier", validSupplierId);
  }

  const sha256 = createHash("sha256").update(content).digest("hex");
  const document = await db.quoteDocument.create({
    data: {
      tenantId: validTenantId,
      sourcingEventId: validSourcingEventId,
      supplierId: validSupplierId,
      fileName,
      mimeType,
      sizeBytes: content.length,
      sha256,
      content,
      uploadedVia: "USER",
      uploadedByUserId: validActorUserId,
    },
  });

  const requestLine = sourcingEvent.requestLine;
  const extraction = await runExtractionAndSave(db, deps.provider, { ...document, content }, {
    requestedProduct: requestLine.product.name,
    requestedQuantity: requestLine.requestedQuantity.toString(),
    requestedUnit: requestLine.unit,
  });

  // Never echo the raw file bytes back over an ordinary JSON response —
  // GET /quote-documents/:id/file is the one dedicated path for that.
  const { content: _content, ...documentWithoutContent } = document;
  return { document: documentWithoutContent, extraction };
}

// Supplier entry path via the RFQ response link (AI-1 item 1b / "partly
// supersedes RFQ-R5"). Mirrors rfqDispatchService.submitSupplierResponse
// exactly for token resolution/consumption (same generic rejection, same
// RFQ-R2/R3 discipline) — the only difference is what is created
// (QuoteDocument, never a QuoteVersion) and the resulting event. No
// Principal/role check: this is the same unauthenticated, token-scoped
// boundary as the existing supplier response route.
export interface UploadSupplierQuoteDocumentInput {
  fileName: string;
  mimeType: string;
  base64: string;
}

export async function uploadSupplierQuoteDocument(
  rawToken: string,
  input: UploadSupplierQuoteDocumentInput,
  deps: QuoteDocumentServiceDeps
) {
  const validRawToken = requireNonEmptyString(rawToken, "token");
  if (input === null || typeof input !== "object") {
    throw new ValidationError("Request body must be an object.");
  }
  const { fileName, mimeType, content } = decodeAndValidateFile(input.fileName, input.mimeType, input.base64);

  const tokenHash = hashToken(validRawToken);
  const dispatch = await prisma.rFQDispatch.findUnique({
    where: { responseTokenHash: tokenHash },
    include: { sourcingEvent: { include: { requestLine: { include: { product: true } } } } },
  });

  const tokenIsUsable =
    dispatch !== null && dispatch.respondedAt === null && dispatch.tokenExpiresAt !== null && dispatch.tokenExpiresAt > new Date();
  if (!dispatch || !tokenIsUsable) {
    throw new NotFoundError("RFQDispatch", "token");
  }

  if (dispatch.tenantId !== dispatch.sourcingEvent.tenantId || dispatch.tenantId !== dispatch.sourcingEvent.requestLine.tenantId) {
    throw new Error(`Internal inconsistency: RFQDispatch ${dispatch.id}'s related data does not all belong to tenant ${dispatch.tenantId}.`);
  }

  const db = tenantScoped(dispatch.tenantId);
  const requestLine = dispatch.sourcingEvent.requestLine;

  const { document } = await db.$transaction(async (tx) => {
    // RFQ-R3-equivalent atomic claim — same shape as submitSupplierResponse's
    // own token-consumption claim, reused here for the document-upload path.
    const claim = await tx.rFQDispatch.updateMany({
      where: {
        id: dispatch.id,
        tenantId: dispatch.tenantId,
        responseTokenHash: tokenHash,
        respondedAt: null,
        tokenExpiresAt: { gt: new Date() },
      },
      data: { respondedAt: new Date() },
    });
    if (claim.count !== 1) {
      throw new NotFoundError("RFQDispatch", "token");
    }

    const sha256 = createHash("sha256").update(content).digest("hex");
    const created = await tx.quoteDocument.create({
      data: {
        tenantId: dispatch.tenantId,
        sourcingEventId: dispatch.sourcingEventId,
        supplierId: dispatch.supplierId,
        rfqDispatchId: dispatch.id,
        fileName,
        mimeType,
        sizeBytes: content.length,
        sha256,
        content,
        uploadedVia: "SUPPLIER_LINK",
        uploadedByUserId: null,
      },
    });

    // Same event history as a form submission — quoteVersionId is null
    // here (no QuoteVersion exists yet; only the buyer's later
    // confirmExtraction creates one).
    await recordSupplierResponseReceivedEvent(tx, {
      tenantId: dispatch.tenantId,
      rfqDispatchId: dispatch.id,
      quoteVersionId: null,
    });

    return { document: created };
  });

  const extraction = await runExtractionAndSave(db, deps.provider, { ...document, content }, {
    requestedProduct: requestLine.product.name,
    requestedQuantity: requestLine.requestedQuantity.toString(),
    requestedUnit: requestLine.unit,
  });

  const { content: _content, ...documentWithoutContent } = document;
  return { document: documentWithoutContent, extraction };
}

export interface ConfirmExtractionReviewedFields {
  productId: string;
  quotedQuantity: string | number;
  unit: string;
  unitPrice: string | number;
  currency: string;
  leadTimeDays?: number;
  paymentTermDays?: number;
  validUntil?: string;
  incoterm?: string;
}

// Human Validation (R12) — the only way a QuoteExtraction's data ever
// becomes a QuoteVersion. Actor must be procurement_user. Atomic claim
// (PENDING_REVIEW -> CONFIRMED) before QuoteVersion creation, in one
// transaction, mirroring RFQ-R3/RFQ-R4's own claim-then-create shape —
// of two concurrent confirms, only one can ever succeed.
export async function confirmExtraction(
  tenantId: string,
  actorUserId: string,
  extractionId: string,
  reviewedFields: ConfirmExtractionReviewedFields
) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validActorUserId = requireId(actorUserId, "actorUserId");
  const validExtractionId = requireId(extractionId, "extractionId");
  await assertActorAuthorized(validTenantId, validActorUserId, ["procurement_user"]);

  const db = tenantScoped(validTenantId);
  const extraction = await db.quoteExtraction.findFirst({
    where: { id: validExtractionId, tenantId: validTenantId },
    include: { quoteDocument: true },
  });
  if (!extraction) {
    throw new NotFoundError("QuoteExtraction", validExtractionId);
  }

  return db.$transaction(async (tx) => {
    const claim = await tx.quoteExtraction.updateMany({
      where: { id: extraction.id, tenantId: validTenantId, status: "PENDING_REVIEW" },
      data: { status: "CONFIRMED", reviewedByUserId: validActorUserId, reviewedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new InvalidStateError(`QuoteExtraction ${validExtractionId} is not PENDING_REVIEW (already reviewed, or concurrently claimed).`);
    }

    const submitInput: SubmitQuoteInput = {
      tenantId: validTenantId,
      sourcingEventId: extraction.quoteDocument.sourcingEventId,
      supplierId: extraction.quoteDocument.supplierId,
      productId: reviewedFields?.productId,
      quotedQuantity: reviewedFields?.quotedQuantity,
      unit: reviewedFields?.unit,
      unitPrice: reviewedFields?.unitPrice,
      currency: reviewedFields?.currency,
      leadTimeDays: reviewedFields?.leadTimeDays,
      paymentTermDays: reviewedFields?.paymentTermDays,
      validUntil: reviewedFields?.validUntil,
      incoterm: reviewedFields?.incoterm,
    };
    // Cast only: `tx` (this transaction's own client) is not nominally
    // the same TS type as tenantScoped()'s return type (it lacks
    // $transaction/$connect/etc.), but is the identical, R15-guarded
    // extended client shape for every model method submitQuote actually
    // calls — exactly the same assumption rfqDispatchService.ts's own
    // $transaction callbacks already rely on structurally.
    const quote = await submitQuote(submitInput, tx as unknown as ReturnType<typeof tenantScoped>);

    const final = await tx.quoteExtraction.updateMany({
      where: { id: extraction.id, tenantId: validTenantId, status: "CONFIRMED" },
      data: { quoteVersionId: quote.versions[0].id },
    });
    if (final.count === 0) {
      throw new Error(`Internal inconsistency: QuoteExtraction ${validExtractionId} was not CONFIRMED when recording its QuoteVersion.`);
    }

    return quote;
  });
}

export async function rejectExtraction(tenantId: string, actorUserId: string, extractionId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validActorUserId = requireId(actorUserId, "actorUserId");
  const validExtractionId = requireId(extractionId, "extractionId");
  await assertActorAuthorized(validTenantId, validActorUserId, ["procurement_user"]);

  const db = tenantScoped(validTenantId);
  const claim = await db.quoteExtraction.updateMany({
    where: { id: validExtractionId, tenantId: validTenantId, status: "PENDING_REVIEW" },
    data: { status: "REJECTED", reviewedByUserId: validActorUserId, reviewedAt: new Date() },
  });
  if (claim.count === 0) {
    throw new InvalidStateError(`QuoteExtraction ${validExtractionId} is not PENDING_REVIEW (already reviewed, or concurrently claimed).`);
  }
  return db.quoteExtraction.findFirst({ where: { id: validExtractionId, tenantId: validTenantId } });
}

// Read-only list for the UI (WorkflowPage.tsx quotes step) — deliberately
// excludes `content` (raw bytes) from the nested QuoteDocument selection.
export async function listQuoteExtractionsForSourcingEvent(tenantId: string, sourcingEventId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validSourcingEventId = requireId(sourcingEventId, "sourcingEventId");
  const db = tenantScoped(validTenantId);

  return db.quoteExtraction.findMany({
    where: { tenantId: validTenantId, quoteDocument: { sourcingEventId: validSourcingEventId } },
    select: {
      id: true,
      provider: true,
      model: true,
      status: true,
      extracted: true,
      errorMessage: true,
      quoteVersionId: true,
      createdAt: true,
      quoteDocument: {
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true, uploadedVia: true, supplierId: true, createdAt: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

// Streams the original file back — tenant-checked. Returns the raw bytes;
// the route layer sets the response headers.
export async function getQuoteDocumentFile(tenantId: string, quoteDocumentId: string) {
  const validTenantId = requireId(tenantId, "tenantId");
  const validQuoteDocumentId = requireId(quoteDocumentId, "quoteDocumentId");
  const db = tenantScoped(validTenantId);

  const document = await db.quoteDocument.findFirst({
    where: { id: validQuoteDocumentId, tenantId: validTenantId },
    select: { fileName: true, mimeType: true, content: true },
  });
  if (!document) {
    throw new NotFoundError("QuoteDocument", validQuoteDocumentId);
  }
  return document;
}
