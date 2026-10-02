import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Product } from "../api/types";

interface Props {
  tenantId: string;
  actorUserId: string;
  products: Product[];
  onCreated: (requestLineId: string) => void;
  onError: (err: unknown) => void;
}

// Client-side checks here are for usability only (brief section 5: "the
// server remains authoritative for validation") — every one of them is
// re-enforced server-side by requestService.createRequest regardless of
// what this form does.
export function NewRequestForm({ tenantId, actorUserId, products, onCreated, onError }: Props) {
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("100");
  const [unit, setUnit] = useState("EA");
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setClientError(null);

    if (!productId) {
      setClientError("Please select a product.");
      return;
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setClientError("Quantity must be a positive number.");
      return;
    }
    if (!unit.trim()) {
      setClientError("Unit is required.");
      return;
    }

    setSubmitting(true);
    try {
      const request = await api.createRequest({
        tenantId,
        createdById: actorUserId,
        lines: [{ productId, requestedQuantity: qty, unit: unit.trim() }],
      });
      onCreated(request.lines[0].id);
    } catch (err) {
      onError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h2>New Procurement Request</h2>
      <div className="form-row">
        <label htmlFor="request-product">Product</label>
        <select id="request-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Select product…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.sku})
            </option>
          ))}
        </select>
      </div>
      <div className="form-row form-row--inline">
        <div>
          <label htmlFor="request-quantity">Quantity</label>
          <input
            id="request-quantity"
            type="number"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="request-unit">Unit</label>
          <input id="request-unit" type="text" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
      </div>
      {clientError && <p className="form-error">{clientError}</p>}
      <button type="submit" className="btn btn--primary" disabled={submitting || !actorUserId}>
        {submitting ? "Creating…" : "Create Request"}
      </button>
      {!actorUserId && <p className="form-hint">Select a tenant and actor above first.</p>}
    </form>
  );
}
