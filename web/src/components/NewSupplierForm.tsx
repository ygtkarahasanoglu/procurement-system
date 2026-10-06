import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import type { Supplier } from "../api/types";

interface Props {
  tenantId: string;
  onCreated: (supplier: Supplier) => void;
  onError: (err: unknown) => void;
}

// Minimal creation form for the existing flat Supplier reference
// (name) — not a supplier identity-resolution subsystem. Client-side
// checks here are for usability only; the server remains authoritative.
export function NewSupplierForm({ tenantId, onCreated, onError }: Props) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

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

  return (
    <form className="panel" onSubmit={handleSubmit}>
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
  );
}
