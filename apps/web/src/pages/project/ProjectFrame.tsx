import type { ProjectDto } from "@testpulse/shared";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LoadError } from "@/components/LoadError";
import { ProjectNotFound } from "@/components/ProjectNotFound";
import { api, ApiError } from "@/lib/api";
import { useDocumentTitle } from "@/lib/forms";
import { useLoad } from "@/lib/useLoad";

export const BACK_LINK_CLASS =
  "inline-flex max-w-full items-center gap-1.5 rounded-sm text-sm font-medium text-link underline-offset-4 outline-hidden hover:underline focus-visible:ring-[3px] focus-visible:ring-ring";

export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
      {label}
    </p>
  );
}

interface ProjectFrameProps {
  slug: string;
  /** Judul halaman (tab browser, `document.title`), tanpa nama project. */
  title: string;
  /** Halaman saat ini, dipakai sebagai tujuan setelah masuk bila project privat. */
  returnTo: string;
  children: (project: ProjectDto) => ReactNode;
}

/**
 * Kerangka halaman hasil test: memuat project (untuk `myRole`), menangani project tidak ditemukan/privat dengan
 * tampilan yang sama seperti `/p/:slug`, dan menyediakan tautan kembali ke ringkasan project.
 */
export function ProjectFrame({ slug, title, returnTo, children }: ProjectFrameProps) {
  const fetchProject = useCallback(() => api.projects.get(slug), [slug]);
  const load = useLoad(fetchProject);
  const notFound = load.state === "error" && load.error instanceof ApiError && load.error.status === 404;

  useDocumentTitle(
    load.state === "ready" ? `${title} · ${load.data.name}` : notFound ? "Project tidak ditemukan" : title,
  );

  if (load.state === "loading") return <Loading label="Memuat project…" />;
  if (notFound) return <ProjectNotFound returnTo={returnTo} />;
  if (load.state === "error") {
    return <LoadError error={load.error} fallback="Gagal memuat project. Coba lagi." onRetry={load.reload} />;
  }

  const project = load.data;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <nav aria-label="Kembali">
        <Link to={`/p/${project.slug}`} className={BACK_LINK_CLASS}>
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{project.name}</span>
        </Link>
      </nav>
      {children(project)}
    </div>
  );
}
