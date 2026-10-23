import { useEffect, useState } from "react";
import { api, formatRupiah, type Product } from "../api";
import { MAX_QTY_PER_ITEM, useStore } from "../state";

export function ProductsPage() {
  const { cart, addToCart } = useStore();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  useEffect(() => {
    api
      .listProducts()
      .then(setProducts)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p role="alert" className="error">Gagal memuat produk: {error}</p>;
  if (!products) return <p aria-busy="true">Memuat produk…</p>;

  return (
    <>
      <h1>Produk</h1>
      <p className="status" role="status" data-testid="add-to-cart-status">
        {lastAdded ? `${lastAdded} ditambahkan ke keranjang` : ""}
      </p>
      <ul className="product-grid" data-testid="product-list">
        {products.map((product) => {
          const inCart = cart.find((l) => l.productId === product.id)?.quantity ?? 0;
          const soldOut = product.stock === 0;
          const limitReached = inCart >= Math.min(product.stock, MAX_QTY_PER_ITEM);
          return (
            <li key={product.id} className="card" data-testid={`product-${product.sku}`}>
              <img src={product.imageUrl} alt={product.name} width={160} height={120} />
              <h2>{product.name}</h2>
              <p className="muted">{product.description}</p>
              <p className="price" data-testid="product-price">
                {formatRupiah(product.price)}
              </p>
              <p className={soldOut ? "stock stock-out" : "stock"} data-testid="product-stock">
                {soldOut ? "Stok habis" : `Stok: ${product.stock}`}
              </p>
              <button
                type="button"
                disabled={soldOut || limitReached}
                onClick={() => {
                  addToCart(product);
                  setLastAdded(product.name);
                }}
                data-testid="add-to-cart"
              >
                {soldOut ? "Habis" : "Tambah ke keranjang"}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
