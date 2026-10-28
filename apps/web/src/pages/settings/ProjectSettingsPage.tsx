import type { ProjectDto, Role } from "@testpulse/shared";
import { useCallback, useState } from "react";
import { ArrowLeft, FolderSearch, Loader2, ShieldAlert } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { LoadError } from "../../components/LoadError";
import { Toast } from "../../components/Toast";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useDocumentTitle } from "../../lib/forms";
import { useLoad } from "../../lib/useLoad";
import { DangerZone } from "./DangerZone";
import { GeneralSection } from "./GeneralSection";
import { InvitationsSection } from "./InvitationsSection";
import { MembersSection } from "./MembersSection";
import { TokensSection } from "./TokensSection";
import { VisibilitySection } from "./VisibilitySection";

/** `/p/:slug/settings` (dibungkus RequireAuth di App). Bagian admin hanya dirender untuk admin; server tetap memeriksa hak akses. */
export function ProjectSettingsPage() {
  const { slug = "" } = useParams();
  const fetchProject = useCallback(() => api.projects.get(slug), [slug]);
  const load = useLoad(fetchProject);
  const notFound = load.state === "error" && load.error instanceof ApiError && load.error.status === 404;

  useDocumentTitle(load.state === "ready" ? `Pengaturan ${load.data.name}` : "Pengaturan project");

  if (load.state === "loading") {
    return (
      <p role="status" className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        Memuat pengaturan…
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
            <Button asChild variant="outline">
              <Link to="/">Ke project saya</Link>
            </Button>
          }
        >
          <p>Project tidak ditemukan, atau Anda tidak memiliki akses.</p>
        </EmptyState>
      </section>
    );
  }
  if (load.state === "error") {
    return <LoadError error={load.error} fallback="Gagal memuat project. Coba lagi." onRetry={load.reload} />;
  }
  return <SettingsContent key={load.data.id} initial={load.data} />;
}

function SettingsContent({ initial }: { initial: ProjectDto }) {
  const { user } = useAuth();
  const [project, setProject] = useState(initial);
  const [toast, setToast] = useState<string | null>(null);

  const dismissToast = useCallback(() => setToast(null), []);

  if (!user) return null;

  if (project.myRole === null) {
    // Project publik dibuka oleh non-anggota: tidak ada yang bisa dikelola.
    return (
      <section className="mx-auto w-full max-w-lg py-4 md:py-10">
        <EmptyState
          icon={ShieldAlert}
          title="Pengaturan hanya untuk anggota"
          headingLevel="h1"
          data-testid="settings-not-member"
          action={
            <Button asChild variant="outline">
              <Link to={`/p/${project.slug}`}>Kembali ke project</Link>
            </Button>
          }
        >
          <p>Anda belum menjadi anggota project ini. Minta admin project untuk mengirim undangan.</p>
        </EmptyState>
      </section>
    );
  }

  const isAdmin = project.myRole === "admin";
  const handleOwnRole = (role: Role) => setProject((p) => ({ ...p, myRole: role }));

  return (
    <section aria-labelledby="settings-title" className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-6">
      <div className="grid gap-3">
        <Link
          to={`/p/${project.slug}`}
          className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-link underline underline-offset-4 hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-hidden"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Kembali ke project
        </Link>
        <h1
          id="settings-title"
          className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]"
          data-testid="settings-title"
        >
          Pengaturan: {project.name}
        </h1>
      </div>

      {isAdmin ? (
        <>
          <GeneralSection project={project} onSaved={setProject} notify={setToast} />
          <VisibilitySection project={project} onSaved={setProject} notify={setToast} />
        </>
      ) : null}
      <MembersSection
        slug={project.slug}
        meId={user.id}
        isAdmin={isAdmin}
        notify={setToast}
        onOwnRoleChanged={handleOwnRole}
      />
      {isAdmin ? (
        <>
          <InvitationsSection slug={project.slug} meId={user.id} meName={user.name} notify={setToast} />
          <TokensSection slug={project.slug} meId={user.id} meName={user.name} notify={setToast} />
          <DangerZone project={project} />
        </>
      ) : null}

      <Toast message={toast} onDismiss={dismissToast} />
    </section>
  );
}
