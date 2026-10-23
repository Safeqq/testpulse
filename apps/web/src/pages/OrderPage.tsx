import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, formatRupiah, type Order } from "../api";
import { useStore } from "../state";

export function OrderPage() {
  const { id } = useParams();
  const { token } = useStore();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    api
      .getOrder(token, id)
      .then(setOrder)
      .catch((err: Error) => setError(err.message));
  }, [token, id]);

  if (error) return <p role="alert" className="error">{error}</p>;
  if (!order) return <p aria-busy="true">Memuat pesanan…</p>;

  return (
    <>
      <h1 data-testid="order-confirmation">Pesanan berhasil dibuat</h1>
      <p>
        Nomor pesanan: <strong data-testid="order-id">#{order.id}</strong> · Status:{" "}
        <span data-testid="order-status">{order.status}</span>
      </p>
      <ul data-testid="order-items">
        {order.items.map((item) => (
          <li key={item.productId}>
            {item.productName} × {item.quantity} — {formatRupiah(item.lineTotal)}
          </li>
        ))}
      </ul>
      <p>
        Total dibayar: <strong data-testid="order-total">{formatRupiah(order.total)}</strong>
      </p>
      <Link to="/">Lanjut belanja</Link>
    </>
  );
}
