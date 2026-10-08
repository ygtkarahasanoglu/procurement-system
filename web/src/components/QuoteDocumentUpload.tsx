import { useState, type ChangeEvent } from "react";
import { api } from "../api/client";
import type { Product, QuoteExtraction } from "../api/types";

// AI-1 (docs/decisions/ratified.md). Document content is untrusted data
// (R11 item 6) — every field below is plain text/number to review and
// edit, never an instruction; nothing here executes anything found
// inside the uploaded file.

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

interface UploadProps {
  sourcingEventId: string;
  supplierId: string;
  onUploaded: () => void;
  onError: (err: unknown) => void;
}

export function QuoteDocumentUploadButton({ sourcingEventId, supplierId, onUploaded, onError }: UploadProps) {
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const base64 = await fileToBase64(file);
      await api.uploadQuoteDocument({ sourcingEventId, supplierId, fileName: file.name, mimeType: file.type, base64 });
      onUploaded();
    } catch (err) {
      onError(err);
    } finally {
      setUploading(false);
    }
  }

  return (
    <label className="btn btn--secondary quote-document-upload-button">
      {uploading ? "Yükleniyor…" : "Teklif dosyası yükle"}
      <input
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.xlsx"
        style={{ display: "none" }}
        onChange={handleFile}
        disabled={uploading}
      />
    </label>
  );
}

interface ReviewProps {
  tenantId: string;
  extraction: QuoteExtraction;
  products: Product[];
  onChanged: () => void;
  onError: (err: unknown) => void;
}

// One extraction's review card: the original file link, and — only
// while PENDING_REVIEW — a pre-filled, fully editable form (plus a line
// picker when the document had more than one candidate line) with
// Onayla/Reddet. FAILED shows the error only; CONFIRMED/REJECTED show
// their resulting status, never a form.
export function QuoteExtractionReview({ tenantId, extraction, products, onChanged, onError }: ReviewProps) {
  const lines = extraction.extracted?.lines ?? [];
  const [lineIndex, setLineIndex] = useState(0);
  const firstLine = lines[0];
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState(firstLine?.quantity ?? "");
  const [unit, setUnit] = useState(firstLine?.unit ?? "EA");
  const [price, setPrice] = useState(firstLine?.unitPrice ?? "");
  const [currency, setCurrency] = useState(firstLine?.currency ?? "EUR");
  const [leadTimeDays, setLeadTimeDays] = useState(extraction.extracted?.leadTimeDays?.toString() ?? "");
  const [paymentTermDays, setPaymentTermDays] = useState(extraction.extracted?.paymentTermDays?.toString() ?? "");
  const [validUntil, setValidUntil] = useState(extraction.extracted?.validUntil?.slice(0, 10) ?? "");
  const [incoterm, setIncoterm] = useState(extraction.extracted?.incoterm ?? "");
  const [clientError, setClientError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pickLine(i: number) {
    setLineIndex(i);
    const l = lines[i];
    if (!l) return;
    setQuantity(l.quantity);
    setUnit(l.unit);
    setPrice(l.unitPrice);
    setCurrency(l.currency);
  }

  async function confirm() {
    setClientError(null);
    const qty = Number(quantity);
    const unitPrice = Number(price);
    if (!productId) return setClientError("Select a product.");
    if (!Number.isFinite(qty) || qty <= 0) return setClientError("Quantity must be a positive number.");
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return setClientError("Unit price must be a positive number.");

    setBusy(true);
    try {
      await api.confirmExtraction(tenantId, extraction.id, {
        productId,
        quotedQuantity: qty,
        unit: unit.trim(),
        unitPrice,
        currency: currency.trim().toUpperCase(),
        ...(leadTimeDays.trim() ? { leadTimeDays: Number(leadTimeDays) } : {}),
        ...(paymentTermDays.trim() ? { paymentTermDays: Number(paymentTermDays) } : {}),
        ...(validUntil.trim() ? { validUntil } : {}),
        ...(incoterm.trim() ? { incoterm: incoterm.trim().toUpperCase() } : {}),
      });
      onChanged();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      await api.rejectExtraction(tenantId, extraction.id);
      onChanged();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel quote-extraction-review">
      <div>
        <a href={api.quoteDocumentFileUrl(tenantId, extraction.quoteDocument.id)} target="_blank" rel="noreferrer">
          {extraction.quoteDocument.fileName}
        </a>{" "}
        <span className="badge">{extraction.status}</span>
      </div>

      {extraction.status === "FAILED" && (
        <p className="form-error">{extraction.errorMessage ?? "AI extraction failed — enter the quote manually below."}</p>
      )}

      {extraction.status === "PENDING_REVIEW" && (
        <form
          className="decision-form"
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
          {lines.length > 1 && (
            <label>
              Satır seç:{" "}
              <select value={lineIndex} onChange={(e) => pickLine(Number(e.target.value))}>
                {lines.map((l, i) => (
                  <option key={i} value={i}>
                    {l.description} — {l.quantity} {l.unit} × {l.unitPrice} {l.currency}
                  </option>
                ))}
              </select>
            </label>
          )}
          <select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Ürün…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Miktar" />
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Birim" className="quote-form__unit" />
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Birim fiyat" />
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            placeholder="Para birimi"
            className="quote-form__currency"
          />
          <input value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} placeholder="Teslim süresi (gün)" />
          <input value={paymentTermDays} onChange={(e) => setPaymentTermDays(e.target.value)} placeholder="Ödeme vadesi (gün)" />
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          <input value={incoterm} onChange={(e) => setIncoterm(e.target.value)} placeholder="Incoterm" />
          <button type="submit" className="btn btn--primary" disabled={busy}>
            Onayla
          </button>
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={reject}>
            Reddet
          </button>
          {clientError && <p className="form-error">{clientError}</p>}
        </form>
      )}
    </div>
  );
}
