import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Supplier } from "../api/types";

interface Props {
  tenantId: string;
  suppliers: Supplier[];
  onCreated: (supplier: Supplier) => void;
  onUpdated: (supplier: Supplier) => void;
  onError: (err: unknown) => void;
}

// The existing-suppliers list below lets a user correct an ordinary
// data-entry mistake (name) on something they already created — no
// delete, no identity-resolution semantics. The edit row is deliberately
// outside the <form> above so Enter inside an edit field never triggers
// the unrelated Create Supplier submit.
export function NewSupplierForm({ tenantId, suppliers, onCreated, onUpdated, onError }: Props) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setClientError(null);
    if (!name.trim()) {
      setClientError("Name is required.");
      return;
    }
    setSubmitting(true);
    try {
      const supplier = await api.createSupplier(tenantId, name.trim());
      onCreated(supplier);
      setName("");
    } catch (err) {
      onError(err);
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(supplier: Supplier) {
    setEditingId(supplier.id);
    setEditName(supplier.name);
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

    setEditSubmitting(true);
    try {
      const updated = await api.updateSupplier(tenantId, editingId, editName.trim());
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
        <h2>New Supplier</h2>
        <div className="form-row">
          <label htmlFor="new-supplier-name">Name</label>
          <input id="new-supplier-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {clientError && <p className="form-error">{clientError}</p>}
        <button type="submit" className="btn btn--secondary" disabled={submitting}>
          {submitting ? "Creating…" : "Create Supplier"}
        </button>
      </form>

      {suppliers.length > 0 && (
        <div className="catalog-list">
          <h3 className="catalog-list__title">Existing Suppliers</h3>
          {suppliers.map((s) =>
            editingId === s.id ? (
              <div className="catalog-list__row catalog-list__row--editing" key={s.id}>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label={`Edit name for ${s.name}`}
                />
                <button type="button" className="btn btn--primary" disabled={editSubmitting} onClick={saveEdit}>
                  {editSubmitting ? "Saving…" : "Save"}
                </button>
                <button type="button" className="btn btn--link" onClick={cancelEdit}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="catalog-list__row" key={s.id}>
                <span>{s.name}</span>
                <button type="button" className="btn btn--link" onClick={() => startEdit(s)}>
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
