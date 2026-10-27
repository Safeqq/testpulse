import { FolderPlus, Loader2, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { RoleBadge, VisibilityBadge } from "@/components/ProjectBadges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadError } from "../components/LoadError";
import { api } from "../lib/api";
import { useDocumentTitle } from "../lib/forms";
import { useLoad } from "../lib/useLoad";

const listProjects = () => api.projects.list();

/** Beranda: daftar project milik user yang masuk (dirender oleh HomeRoute untuk user yang sudah masuk). */
export function ProjectsPage() {
  useDocumentTitle("Project saya");
  const load = useLoad(listProjects);

  return (
    <section aria-labelledby="projects-title" className="grid grid-cols-1 gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 id="projects-title" className="text-2xl font-semibold tracking-tight">
            Project saya
          </h1>
          <p className="mt-1 text-muted-foreground">Project tempat Anda menjadi anggota.</p>
        </div>
        <Button asChild size="lg" className="shrink-0">
          <Link to="/projects/new" data-testid="new-project">
            <Plus aria-hidden="true" />
            Buat project
          </Link>
        </Button>
      </div>

      {load.state === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
          Memuat project…
        </p>
      ) : load.state === "error" ? (
        <LoadError error={load.error} fallback="Gagal memuat project. Coba lagi." onRetry={load.reload} />
      ) : load.data.length === 0 ? (
        <EmptyState icon={FolderPlus} title="Belum ada project" data-testid="empty-projects">
          <p>Buat project pertama Anda untuk mulai mengumpulkan hasil test tim.</p>
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="project-list">
          {load.data.map((project) => (
            <li key={project.id} className="min-w-0" data-testid={`project-item-${project.slug}`}>
              <Card className="relative h-full gap-3 p-5 transition-colors focus-within:border-ring hover:border-ring">
                <div className="min-w-0">
                  <Link
                    to={`/p/${project.slug}`}
                    title={project.name}
                    className="block truncate rounded-sm text-base font-semibold text-foreground outline-hidden after:absolute after:inset-0 after:rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring"
                  >
                    {project.name}
                  </Link>
                  <p className="mt-1 truncate font-mono text-sm text-muted-foreground">/p/{project.slug}</p>
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <VisibilityBadge visibility={project.visibility} />
                  {project.myRole ? <RoleBadge role={project.myRole} /> : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
