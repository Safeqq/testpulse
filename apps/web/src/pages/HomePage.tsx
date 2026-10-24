import { useAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/forms";

/** Placeholder beranda; daftar project ditambahkan di task berikutnya. */
export function HomePage() {
  useDocumentTitle("Project saya");
  const { user } = useAuth();

  return (
    <section>
      <h1>Project saya</h1>
      <p className="lead">Halo, {user?.name}. Daftar project Anda akan tampil di sini.</p>
    </section>
  );
}
