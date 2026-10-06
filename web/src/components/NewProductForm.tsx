import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Product } from "../api/types";

interface Props {
  tenantId: string;
  onCreated: (product: Product) => void;
  onError: (err: unknown) => void;
}

// Minimal creation form for the existing flat Product reference (name,
// sku) — not a product master-data/identity subsystem. Client-side
// checks here are for usability only; the server remains authoritative.
export function NewProductForm({ tenantId, onCreated, onError }: Props) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setClientError(null);

    if (!name.trim()) {
      setClientError("Name is required.");
      return;
    }
    if (!sku.trim()) {
      setClientError("SKU is required.");
      return;
    }

    setSubmitting(true);
    try {
      const product = await api.createProduct(tenantId, name.trim(), sku.trim());
      onCreated(product);
      setName("");
      setSku("");
    } catch (err) {
      onError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h2>New Product</h2>
      <div className="form-row form-row--inline">
        <div>
          <label htmlFor="new-product-name">Name</label>
          <input id="new-product-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="new-product-sku">SKU</label>
          <input id="new-product-sku" type="text" value={sku} onChange={(e) => setSku(e.target.value)} />
        </div>
      </div>
      {clientError && <p className="form-error">{clientError}</p>}
      <button type="submit" className="btn btn--secondary" disabled={submitting}>
        {submitting ? "Creating…" : "Create Product"}
      </button>
    </form>
  );
}
