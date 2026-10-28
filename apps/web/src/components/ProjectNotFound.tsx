import { FolderSearch } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { loginPathFor } from "@/lib/navigation";

/**
 * Project tidak ada atau privat bagi pengunjung: tampilannya sama persis agar keberadaan project privat tidak bocor
 * (spec Tahap 1 §5.7). `returnTo` adalah halaman yang dibuka kembali setelah masuk.
 */
export function ProjectNotFound({ returnTo }: { returnTo: string }) {
  const { status } = useAuth();
  return (
    <section className="mx-auto w-full max-w-lg py-4 md:py-10">
      <EmptyState
        icon={FolderSearch}
        title="Project tidak ditemukan"
        headingLevel="h1"
        data-testid="project-not-found"
        action={
          status === "anonymous" ? (
            <Button asChild>
              <Link to={loginPathFor(returnTo)}>Masuk</Link>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link to="/">Ke project saya</Link>
            </Button>
          )
        }
      >
        <p>Project tidak ditemukan. Jika ini project privat, silakan masuk.</p>
      </EmptyState>
    </section>
  );
}
