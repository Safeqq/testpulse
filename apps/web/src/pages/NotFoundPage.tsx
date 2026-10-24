import { Link } from "react-router-dom";
import { useDocumentTitle } from "../lib/forms";

export function NotFoundPage() {
  useDocumentTitle("Halaman tidak ditemukan");

  return (
    <section>
      <h1>Halaman tidak ditemukan</h1>
      <p className="lead">Alamat yang Anda buka tidak tersedia.</p>
      <p>
        <Link to="/">Kembali ke beranda</Link>
      </p>
    </section>
  );
}
