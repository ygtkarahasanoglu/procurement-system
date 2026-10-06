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

interface LineFormState {
  productId: string;
  quantity: string;
  unit: string;
}

function newLine(): LineFormState {
  return { productId: "", quantity: "100", unit: "EA" };
}

// Client-side checks here are for usability only (brief section 5: "the
// server remains authoritative for validation") — every one of them is
// re-enforced server-side by requestService.createRequest regardless of
// what this form does. RL-C1 (docs/decisions/ratified.md): a
// ProcurementRequest may contain multiple distinct product/service
// lines — requestService.createRequest already accepts and validates an
// array of lines; this form only needed to let the user build one.
export function NewRequestForm({ tenantId, actorUserId, products, onCreated, onError }: Props) {
  const [lines, setLines] = useState<LineFormState[]>([newLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  function updateLine(index: number, patch: Partial<LineFormState>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setClientError(null);

    const validatedLines: { productId: string; requestedQuantity: number; unit: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineLabel = lines.length > 1 ? `Line ${i + 1}: ` : "";
      if (!line.productId) {
        setClientError(`${lineLabel}Please select a product.`);
        return;
      }
      const qty = Number(line.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        setClientError(`${lineLabel}Quantity must be a positive number.`);
        return;
      }
      if (!line.unit.trim()) {
        setClientError(`${lineLabel}Unit is required.`);
        return;
      }
      validatedLines.push({ productId: line.productId, requestedQuantity: qty, unit: line.unit.trim() });
    }

    setSubmitting(true);
    try {
      const request = await api.createRequest({
        tenantId,
        createdById: actorUserId,
        lines: validatedLines,
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
      {lines.map((line, index) => (
        <div className="form-row form-row--line" key={index}>
          {lines.length > 1 && <div className="form-row__line-label">Line {index + 1}</div>}
          <div className="form-row">
            <label htmlFor={`request-product-${index}`}>Product</label>
            <select
              id={`request-product-${index}`}
              value={line.productId}
              onChange={(e) => updateLine(index, { productId: e.target.value })}
            >
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
              <label htmlFor={`request-quantity-${index}`}>Quantity</label>
              <input
                id={`request-quantity-${index}`}
                type="number"
                min="0"
                step="any"
                value={line.quantity}
                onChange={(e) => updateLine(index, { quantity: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor={`request-unit-${index}`}>Unit</label>
              <input
                id={`request-unit-${index}`}
                type="text"
                value={line.unit}
                onChange={(e) => updateLine(index, { unit: e.target.value })}
              />
            </div>
            {lines.length > 1 && (
              <button
                type="button"
                className="btn btn--link"
                onClick={() => removeLine(index)}
                aria-label={`Remove line ${index + 1}`}
              >
                Remove Line
              </button>
            )}
          </div>
        </div>
      ))}
      <button type="button" className="btn btn--secondary" onClick={addLine}>
        Add Line
      </button>
      {clientError && <p className="form-error">{clientError}</p>}
      <button type="submit" className="btn btn--primary" disabled={submitting || !actorUserId}>
        {submitting ? "Creating…" : "Create Request"}
      </button>
      {!actorUserId && <p className="form-hint">Select a tenant and actor above first.</p>}
    </form>
  );
}
