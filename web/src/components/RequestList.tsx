import type { ProcurementRequest } from "../api/types";

interface Props {
  requests: ProcurementRequest[];
  onOpenLine: (requestLineId: string) => void;
}

export function RequestList({ requests, onOpenLine }: Props) {
  if (requests.length === 0) {
    return <p className="empty-state">No requests yet. Create one to begin the workflow.</p>;
  }
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Request</th>
          <th>Status</th>
          <th>Line</th>
          <th>Product</th>
          <th>Requested Qty</th>
          <th>Unit</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {requests.flatMap((r) =>
          r.lines.map((line) => (
            <tr key={line.id}>
              <td className="mono">{r.id.slice(0, 8)}</td>
              <td>{r.status}</td>
              <td className="mono">{line.id.slice(0, 8)}</td>
              <td>{line.product.name}</td>
              <td>{line.requestedQuantity}</td>
              <td>{line.unit}</td>
              <td>
                <button className="btn btn--secondary" onClick={() => onOpenLine(line.id)}>
                  Open workflow →
                </button>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
