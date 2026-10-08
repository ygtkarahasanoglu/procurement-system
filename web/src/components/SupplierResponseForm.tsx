import { useState, type ChangeEvent, type FormEvent } from "react";
import { api } from "../api/client";

interface Props {
  token: string;
  onSubmitted: () => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

// AI-1 (docs/decisions/ratified.md) — "partly supersedes RFQ-R5": the
// alternative to filling the form. Uploading a document consumes the
// response token exactly like a form submission (same dispatch state
// change, same event history) — it never creates a QuoteVersion itself;
// a procurement user reviews and confirms it later from the internal
// workflow screen.
export function SupplierDocumentUpload({ token, onSubmitted }: Props) {
  const [uploading, setUploading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setServerError(null);
    setUploading(true);
    try {
      const base64 = await fileToBase64(file);
      await api.uploadRfqResponseDocument(token, { fileName: file.name, mimeType: file.type, base64 });
      onSubmitted();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="supplier-document-upload">
      <label className="btn btn--secondary">
        {uploading ? "Yükleniyor…" : "veya teklif dosyanızı yükleyin"}
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.xlsx"
          style={{ display: "none" }}
          onChange={handleFile}
          disabled={uploading}
        />
      </label>
      {serverError && <p className="form-error">{serverError}</p>}
    </div>
  );
}

// RFQ UI End-to-End V1. Collects exactly the four RFQ-R5 fields the
// backend accepts (quantity, unit, unitPrice, currency) — no other
// commercial field exists here. Client-side validation below is
// usability only, mirroring QuoteForm.tsx's own discipline: the server
// (requirePositiveDecimal/requireUnit/requireCurrency,
// rfqDispatchService.submitSupplierResponse) remains the sole authority
// and is never bypassed or replaced by this check.
export function SupplierResponseForm({ token, onSubmitted }: Props) {
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("EA");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setClientError(null);
    setServerError(null);
    const qty = Number(quantity);
    const unitPrice = Number(price);
    if (!Number.isFinite(qty) || qty <= 0) return setClientError("Quantity must be a positive number.");
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return setClientError("Unit price must be a positive number.");
    if (!unit.trim()) return setClientError("Unit is required.");
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) return setClientError("Currency must be a 3-letter code (e.g. EUR).");

    setSubmitting(true);
    try {
      await api.submitRfqResponse(token, { quantity: qty, unit: unit.trim(), unitPrice, currency: currency.trim().toUpperCase() });
      onSubmitted();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="quote-form" onSubmit={handleSubmit}>
      <input type="number" min="0" step="any" placeholder="Qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      <input type="text" placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="quote-form__unit" />
      <input type="number" min="0" step="any" placeholder="Unit price" value={price} onChange={(e) => setPrice(e.target.value)} />
      <input
        type="text"
        placeholder="Currency"
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
        className="quote-form__currency"
      />
      <button type="submit" className="btn btn--primary" disabled={submitting}>
        {submitting ? "Submitting…" : "Submit Response"}
      </button>
      {clientError && <p className="form-error">{clientError}</p>}
      {serverError && <p className="form-error">{serverError}</p>}
    </form>
  );
}
