import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError, api, formatRupiah, type Quote } from "../api";
import { useStore } from "../state";

export function CheckoutPage() {
  const { cart, token, clearCart, logout } = useStore();
  const navigate = useNavigate();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<string | undefined>(undefined);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  const items = cart.map((l) => ({ productId: l.productId, quantity: l.quantity }));
  const itemsKey = JSON.stringify(items);

  const loadQuote = useCallback(
    async (promoCode?: string) => {
      const result = await api.quote(JSON.parse(itemsKey), promoCode);
      setQuote(result);
      return result;
    },
    [itemsKey],
  );

  // Isi keranjang tidak bisa diubah dari halaman ini, jadi quote awal cukup dimuat sekali.
  // Perubahan promo ditangani langsung oleh onApplyPromo / onRemovePromo.
  useEffect(() => {
    if (itemsKey === "[]") return;
    loadQuote().catch((err: Error) => setError(err.message));
  }, [itemsKey, loadQuote]);

  if (cart.length === 0) {
    return (
      <>
        <h1>Checkout</h1>
        <p>
          Keranjang kosong. <Link to="/">Lihat produk</Link>
        </p>
      </>
    );
  }

  async function onApplyPromo(event: FormEvent) {
    event.preventDefault();
    setPromoError(null);
    const code = promoInput.trim();
    if (!code) return;
    try {
      await loadQuote(code);
      setAppliedPromo(code);
    } catch (err) {
      setPromoError((err as Error).message);
    }
  }

  async function onRemovePromo() {
    setAppliedPromo(undefined);
    setPromoInput("");
    setPromoError(null);
    await loadQuote().catch((err: Error) => setError(err.message));
  }

  async function onPlaceOrder() {
    setError(null);
    setPlacing(true);
    try {
      const order = await api.createOrder(token!, items, appliedPromo);
      clearCart();
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate("/login?next=/checkout");
        return;
      }
      setError((err as Error).message);
    } finally {
      setPlacing(false);
    }
  }

  return (
    <>
      <h1>Checkout</h1>
      {error && (
        <p role="alert" className="error" data-testid="checkout-error">
          {error}
        </p>
      )}
      {!quote ? (
        <p aria-busy="true">Menghitung total…</p>
      ) : (
        <>
          <table className="table" data-testid="checkout-items">
            <thead>
              <tr>
                <th scope="col">Produk</th>
                <th scope="col">Jumlah</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item) => (
                <tr key={item.productId}>
                  <td>{item.productName}</td>
                  <td>{item.quantity}</td>
                  <td>{formatRupiah(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <form className="promo" onSubmit={onApplyPromo}>
            <label htmlFor="promo">Kode promo</label>
            <input
              id="promo"
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value)}
              disabled={!!appliedPromo}
              data-testid="promo-input"
            />
            {appliedPromo ? (
              <button type="button" className="secondary" onClick={onRemovePromo} data-testid="promo-remove">
                Hapus promo
              </button>
            ) : (
              <button type="submit" className="secondary" data-testid="promo-apply">
                Terapkan
              </button>
            )}
          </form>
          {promoError && (
            <p role="alert" className="error" data-testid="promo-error">
              {promoError}
            </p>
          )}

          <dl className="totals">
            <dt>Subtotal</dt>
            <dd data-testid="total-subtotal">{formatRupiah(quote.subtotal)}</dd>
            <dt>Diskon{quote.promoCode ? ` (${quote.promoCode})` : ""}</dt>
            <dd data-testid="total-discount">−{formatRupiah(quote.discount)}</dd>
            <dt>Ongkos kirim</dt>
            <dd data-testid="total-shipping">{quote.shipping === 0 ? "Gratis" : formatRupiah(quote.shipping)}</dd>
            <dt className="grand">Total</dt>
            <dd className="grand" data-testid="total-grand">
              {formatRupiah(quote.total)}
            </dd>
          </dl>

          <button type="button" onClick={onPlaceOrder} disabled={placing} data-testid="place-order">
            {placing ? "Memproses pesanan…" : "Buat pesanan"}
          </button>
        </>
      )}
    </>
  );
}
