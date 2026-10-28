import type { ProjectDto } from "@testpulse/shared";
import { ArrowLeft } from "lucide-react";
import { useCallback, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { ProjectNotFound } from "@/components/ProjectNotFound";
import { api, ApiError } from "@/lib/api";
import { useDocumentTitle } from "@/lib/forms";
import { useLoad } from "@/lib/useLoad";

export const BACK_LINK_CLASS =
  "inline-flex max-w-full items-center gap-1.5 rounded-sm text-sm font-medium text-link underline-offset-4 outline-hidden hover:underline focus-visible:ring-[3px] focus-visible:ring-ring";

interface ProjectFrameProps {
  slug: string;
  /** Judul halaman (tab browser, `document.title`), tanpa nama project. */
  title: string;
  children: (project: ProjectDto) => ReactNode;
}

/**
 * Kerangka halaman hasil test: memuat project (untuk `myRole`), menangani project tidak ditemukan/privat dengan
 * tampilan yang sama seperti `/p/:slug`, dan menyediakan tautan kembali ke ringkasan project.
 */
export function ProjectFrame({ slug, title, children }: ProjectFrameProps) {
  // Setelah masuk, pengguna kembali ke halaman ini lengkap dengan query-nya (mis. ?branch=).
  const { pathname, search } = useLocation();
  const fetchProject = useCallback(() => api.projects.get(slug), [slug]);
  const load = useLoad(fetchProject);
  const notFound = load.state === "error" && load.error instanceof ApiError && load.error.status === 404;

  useDocumentTitle(
    load.state === "ready" ? `${title} · ${load.data.name}` : notFound ? "Project tidak ditemukan" : title,
  );

  if (load.state === "loading") return <Loading label="Memuat project…" />;
  if (notFound) return <ProjectNotFound returnTo={`${pathname}${search}`} />;
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
