import { Link, useNavigate } from "react-router";
import { formatRupiah } from "../api";
import { MAX_QTY_PER_ITEM, useStore } from "../state";

export function CartPage() {
  const { cart, setQuantity, removeFromCart } = useStore();
  const navigate = useNavigate();

  if (cart.length === 0) {
    return (
      <>
        <h1>Keranjang</h1>
        <p data-testid="cart-empty">
          Keranjang kosong. <Link to="/">Lihat produk</Link>
        </p>
      </>
    );
  }

  const subtotal = cart.reduce((sum, l) => sum + l.price * l.quantity, 0);

  return (
    <>
      <h1>Keranjang</h1>
      <table className="table" data-testid="cart-table">
        <thead>
          <tr>
            <th scope="col">Produk</th>
            <th scope="col">Harga</th>
            <th scope="col">Jumlah</th>
            <th scope="col">Total</th>
            <th scope="col">
              <span className="sr-only">Aksi</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {cart.map((line) => (
            <tr key={line.productId} data-testid={`cart-line-${line.productId}`}>
              <td>{line.name}</td>
              <td>{formatRupiah(line.price)}</td>
              <td>
                <div className="qty">
                  <button
                    type="button"
                    aria-label={`Kurangi jumlah ${line.name}`}
                    disabled={line.quantity <= 1}
                    onClick={() => setQuantity(line.productId, line.quantity - 1)}
                    data-testid="qty-decrease"
                  >
                    −
                  </button>
                  <span data-testid="qty-value" aria-live="polite">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label={`Tambah jumlah ${line.name}`}
                    disabled={line.quantity >= Math.min(line.stock, MAX_QTY_PER_ITEM)}
                    onClick={() => setQuantity(line.productId, line.quantity + 1)}
                    data-testid="qty-increase"
                  >
                    +
                  </button>
                </div>
              </td>
              <td data-testid="line-total">{formatRupiah(line.price * line.quantity)}</td>
              <td>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => removeFromCart(line.productId)}
                  data-testid="remove-line"
                >
                  Hapus
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="summary">
        <p>
          Subtotal: <strong data-testid="cart-subtotal">{formatRupiah(subtotal)}</strong>
        </p>
        <button type="button" onClick={() => navigate("/checkout")} data-testid="go-to-checkout">
          Lanjut ke checkout
        </button>
      </div>
    </>
  );
}
