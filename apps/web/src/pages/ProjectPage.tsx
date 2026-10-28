import { FolderSearch, Globe, Loader2, Settings } from "lucide-react";
import { useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { RoleBadge, VisibilityBadge } from "@/components/ProjectBadges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadError } from "../components/LoadError";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/forms";
import { loginPathFor } from "../lib/navigation";
import { useLoad } from "../lib/useLoad";
import { ProjectResults } from "./project/ProjectResults";

/** Ringkasan project. Terbuka tanpa login untuk project publik; project privat/tidak ada tampil sama (spec §5.7). */
export function ProjectPage() {
  const { slug = "" } = useParams();
  const { status } = useAuth();
  const fetchProject = useCallback(() => api.projects.get(slug), [slug]);
  const load = useLoad(fetchProject);
  const notFound = load.state === "error" && load.error instanceof ApiError && load.error.status === 404;

  useDocumentTitle(load.state === "ready" ? load.data.name : notFound ? "Project tidak ditemukan" : "Project");

  if (load.state === "loading") {
    return (
      <p role="status" className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        Memuat project…
      </p>
    );
  }

  if (notFound) {
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
                <Link to={loginPathFor(`/p/${slug}`)}>Masuk</Link>
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

  if (load.state === "error") {
    return <LoadError error={load.error} fallback="Gagal memuat project. Coba lagi." onRetry={load.reload} />;
  }

  const project = load.data;
  const isMember = project.myRole !== null;

  return (
    <section aria-labelledby="project-title" className="grid grid-cols-1 gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 sm:flex-1">
          <h1
            id="project-title"
            className="truncate text-2xl font-semibold tracking-tight"
            title={project.name}
            data-testid="project-title"
          >
            {project.name}
          </h1>
          <p className="mt-1 truncate font-mono text-sm text-muted-foreground">/p/{project.slug}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!isMember && project.visibility === "public" ? (
              <Badge variant="default" data-testid="public-badge">
                <Globe aria-hidden="true" />
                Project publik · hanya-baca
              </Badge>
            ) : (
              <VisibilityBadge visibility={project.visibility} />
            )}
            {project.myRole ? <RoleBadge role={project.myRole} prefix="Peran Anda: " /> : null}
          </div>
        </div>
        <div className="shrink-0">
          {isMember ? (
            <Button asChild variant="outline">
              <Link to={`/p/${project.slug}/settings`} data-testid="settings-link">
                <Settings aria-hidden="true" />
                Pengaturan
              </Link>
            </Button>
          ) : status === "anonymous" ? (
            <Button asChild>
              <Link to={loginPathFor(`/p/${project.slug}`)} data-testid="project-login">
                Masuk
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <ProjectResults project={project} />
    </section>
  );
}
