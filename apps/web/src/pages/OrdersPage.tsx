import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, formatRupiah, type Order } from "../api";
import { useStore } from "../state";

export function OrdersPage() {
  const { token } = useStore();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .listOrders(token)
      .then(setOrders)
      .catch((err: Error) => setError(err.message));
  }, [token]);

  if (error) return <p role="alert" className="error">{error}</p>;
  if (!orders) return <p aria-busy="true">Memuat pesanan…</p>;

  return (
    <>
      <h1>Pesanan Saya</h1>
      {orders.length === 0 ? (
        <p data-testid="orders-empty">Belum ada pesanan.</p>
      ) : (
        <ul className="order-list" data-testid="order-list">
          {orders.map((order) => (
            <li key={order.id}>
              <Link to={`/orders/${order.id}`}>Pesanan #{order.id}</Link> · {order.items.length} produk ·{" "}
              {formatRupiah(order.total)} · {new Date(order.createdAt).toLocaleString("id-ID")}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
