import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Tenant, User } from "../api/types";

// Minimal development tenant/actor selector (brief section 15): there is
// no login system. The selected actor id is just sent as a plain field
// on each request; the SERVER independently looks up that id within the
// claimed tenant and checks its role before allowing any consequential
// action (see assertActorAuthorized in the backend). Picking a user here
// grants nothing by itself — it is a convenience for choosing which real,
// server-validated actor to act as, not a client-side permission grant.
export interface ActorSelection {
  tenantId: string;
  actorUserId: string;
}

interface Props {
  selection: ActorSelection | null;
  onChange: (selection: ActorSelection) => void;
}

export function TenantActorBar({ selection, onChange }: Props) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tenantId, setTenantId] = useState(selection?.tenantId ?? "");
  const [actorUserId, setActorUserId] = useState(selection?.actorUserId ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listTenants()
      .then(setTenants)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!tenantId) {
      setUsers([]);
      return;
    }
    api
      .getTenantContext(tenantId)
      .then((ctx) => setUsers(ctx.users))
      .catch((err) => setError(err.message));
  }, [tenantId]);

  useEffect(() => {
    if (tenantId && actorUserId) {
      onChange({ tenantId, actorUserId });
    }
    // onChange is a stable setter from the parent; including it would
    // re-run this on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, actorUserId]);

  return (
    <div className="actor-bar">
      <div className="actor-bar__field">
        <label htmlFor="tenant-select">Tenant</label>
        <select
          id="tenant-select"
          value={tenantId}
          onChange={(e) => {
            setTenantId(e.target.value);
            setActorUserId("");
          }}
        >
          <option value="">Select tenant…</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="actor-bar__field">
        <label htmlFor="actor-select">Acting as</label>
        <select id="actor-select" value={actorUserId} onChange={(e) => setActorUserId(e.target.value)} disabled={!tenantId}>
          <option value="">Select user…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.role})
            </option>
          ))}
        </select>
      </div>
      {error && <span className="actor-bar__error">{error}</span>}
    </div>
  );
}
