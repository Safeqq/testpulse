import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "../lib/forms";

export function NotFoundPage() {
  useDocumentTitle("Halaman tidak ditemukan");

  return (
    <section className="mx-auto grid max-w-md justify-items-center gap-3 py-12 text-center md:py-20">
      <Badge variant="secondary">404</Badge>
      <h1 className="text-2xl font-semibold tracking-tight">Halaman tidak ditemukan</h1>
      <p className="text-muted-foreground">Alamat yang Anda buka tidak tersedia.</p>
      <Button asChild className="mt-2">
        <Link to="/">Kembali ke beranda</Link>
      </Button>
    </section>
  );
}
