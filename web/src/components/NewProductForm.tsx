import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Product } from "../api/types";

interface Props {
  tenantId: string;
  products: Product[];
  onCreated: (product: Product) => void;
  onUpdated: (product: Product) => void;
  onError: (err: unknown) => void;
}

// Minimal creation form for the existing flat Product reference (name,
// sku) — not a product master-data/identity subsystem. Client-side
// checks here are for usability only; the server remains authoritative.
// The existing-products list below lets a user correct an ordinary
// data-entry mistake (name/sku) on something they already created — no
// delete, no identity/matching semantics. The edit row is deliberately
// outside the <form> above so Enter inside an edit field never triggers
// the unrelated Create Product submit.
export function NewProductForm({ tenantId, products, onCreated, onUpdated, onError }: Props) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSku, setEditSku] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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

  function startEdit(product: Product) {
    setEditingId(product.id);
    setEditName(product.name);
    setEditSku(product.sku);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    setEditError(null);
    if (!editName.trim()) {
      setEditError("Name is required.");
      return;
    }
    if (!editSku.trim()) {
      setEditError("SKU is required.");
      return;
    }

    setEditSubmitting(true);
    try {
      const updated = await api.updateProduct(tenantId, editingId, editName.trim(), editSku.trim());
      onUpdated(updated);
      setEditingId(null);
    } catch (err) {
      onError(err);
    } finally {
      setEditSubmitting(false);
    }
  }

  return (
    <div className="panel">
      <form onSubmit={handleSubmit}>
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

      {products.length > 0 && (
        <div className="catalog-list">
          <h3 className="catalog-list__title">Existing Products</h3>
          {products.map((p) =>
            editingId === p.id ? (
              <div className="catalog-list__row catalog-list__row--editing" key={p.id}>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label={`Edit name for ${p.name}`}
                />
                <input
                  type="text"
                  value={editSku}
                  onChange={(e) => setEditSku(e.target.value)}
                  aria-label={`Edit SKU for ${p.name}`}
                />
                <button type="button" className="btn btn--primary" disabled={editSubmitting} onClick={saveEdit}>
                  {editSubmitting ? "Saving…" : "Save"}
                </button>
                <button type="button" className="btn btn--link" onClick={cancelEdit}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="catalog-list__row" key={p.id}>
                <span>
                  {p.name} ({p.sku})
                </span>
                <button type="button" className="btn btn--link" onClick={() => startEdit(p)}>
                  Edit
                </button>
              </div>
            )
          )}
          {editError && <p className="form-error">{editError}</p>}
        </div>
      )}
    </div>
  );
}
