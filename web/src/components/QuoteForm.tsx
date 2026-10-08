import { useState, type FormEvent } from "react";
import type { Supplier } from "../api/types";

interface Props {
  suppliers: Supplier[];
  onSubmit: (input: {
    supplierId: string;
    quotedQuantity: number;
    unit: string;
    unitPrice: number;
    currency: string;
    leadTimeDays?: number;
    paymentTermDays?: number;
    validUntil?: string;
    incoterm?: string;
  }) => Promise<void>;
}

export function QuoteForm({ suppliers, onSubmit }: Props) {
  const [supplierId, setSupplierId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("EA");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("EUR");
  // AI-1 (docs/decisions/ratified.md): optional, displayed-only fields —
  // left blank by default, never required.
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [paymentTermDays, setPaymentTermDays] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [incoterm, setIncoterm] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setClientError(null);
    const qty = Number(quantity);
    const unitPrice = Number(price);
    if (!supplierId) return setClientError("Select a supplier.");
    if (!Number.isFinite(qty) || qty <= 0) return setClientError("Quoted quantity must be a positive number.");
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return setClientError("Unit price must be a positive number.");
    if (!unit.trim()) return setClientError("Unit is required.");
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) return setClientError("Currency must be a 3-letter code (e.g. EUR).");

    setSubmitting(true);
    try {
      await onSubmit({
        supplierId,
        quotedQuantity: qty,
        unit: unit.trim(),
        unitPrice,
        currency: currency.trim().toUpperCase(),
        ...(leadTimeDays.trim() ? { leadTimeDays: Number(leadTimeDays) } : {}),
        ...(paymentTermDays.trim() ? { paymentTermDays: Number(paymentTermDays) } : {}),
        ...(validUntil.trim() ? { validUntil } : {}),
        ...(incoterm.trim() ? { incoterm: incoterm.trim().toUpperCase() } : {}),
      });
      setQuantity("");
      setPrice("");
      setLeadTimeDays("");
      setPaymentTermDays("");
      setValidUntil("");
      setIncoterm("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="quote-form" onSubmit={handleSubmit}>
      <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
        <option value="">Supplier…</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
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
      <input
        type="number"
        min="0"
        step="1"
        placeholder="Lead time (days)"
        value={leadTimeDays}
        onChange={(e) => setLeadTimeDays(e.target.value)}
      />
      <input
        type="number"
        min="0"
        step="1"
        placeholder="Payment term (days)"
        value={paymentTermDays}
        onChange={(e) => setPaymentTermDays(e.target.value)}
      />
      <input type="date" placeholder="Valid until" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
      <input type="text" placeholder="Incoterm" value={incoterm} onChange={(e) => setIncoterm(e.target.value)} />
      <button type="submit" className="btn btn--secondary" disabled={submitting}>
        {submitting ? "Submitting…" : "Submit Quote"}
      </button>
      {clientError && <p className="form-error">{clientError}</p>}
    </form>
  );
}
