import { lazy, Suspense, type ReactNode } from "react";
import { ChunkErrorBoundary } from "@/components/ChunkErrorBoundary";

// Markdown berat (react-markdown + remark): chunk-nya hanya diunduh saat ada isi yang harus dirender.
const Markdown = lazy(() => import("./Markdown").then((m) => ({ default: m.Markdown })));

interface LazyMarkdownProps {
  source: string;
  /** Pesan bila chunk gagal dimuat; kegagalan hanya mematikan blok ini, bukan seluruh halaman. */
  failedMessage?: ReactNode;
  failedTestId?: string;
}

/**
 * Pintu masuk Markdown untuk halaman biasa: memuat `Markdown` secara lazy dengan penanda memuat dan pesan gagal lokal.
 * Beberapa blok pada satu halaman (deskripsi dan banyak komentar) memakai satu chunk yang sama.
 */
export function LazyMarkdown({
  source,
  failedMessage = "Isi gagal dimuat. Periksa koneksi lalu muat ulang halaman.",
  failedTestId,
}: LazyMarkdownProps) {
  return (
    <ChunkErrorBoundary
      fallback={
        <p role="alert" className="m-0 text-sm font-medium text-destructive" data-testid={failedTestId}>
          {failedMessage}
        </p>
      }
    >
      <Suspense fallback={<p className="m-0 text-sm text-muted-foreground">Memuat…</p>}>
        <Markdown source={source} />
      </Suspense>
    </ChunkErrorBoundary>
  );
}
