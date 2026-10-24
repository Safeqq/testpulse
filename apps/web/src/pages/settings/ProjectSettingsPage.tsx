import type { ProjectDto, Role } from "@testpulse/shared";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
      <p role="status" className="loading">
        Memuat pengaturan…
      </p>
    );
  }
  if (notFound) {
    return (
      <section className="empty-state" data-testid="project-not-found">
        <h1>Project tidak ditemukan</h1>
        <p>Project tidak ditemukan, atau Anda tidak memiliki akses.</p>
        <Link to="/" className="button button-secondary">
          Ke project saya
        </Link>
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
      <section className="empty-state" data-testid="settings-not-member">
        <h1>Pengaturan hanya untuk anggota</h1>
        <p>Anda belum menjadi anggota project ini. Minta admin project untuk mengirim undangan.</p>
        <Link to={`/p/${project.slug}`} className="button button-secondary">
          Kembali ke project
        </Link>
      </section>
    );
  }

  const isAdmin = project.myRole === "admin";
  const handleOwnRole = (role: Role) => setProject((p) => ({ ...p, myRole: role }));

  return (
    <section aria-labelledby="settings-title" className="settings">
      <div className="page-header">
        <div>
          <h1 id="settings-title" data-testid="settings-title">
            Pengaturan: {project.name}
          </h1>
          <p className="lead">
            <Link to={`/p/${project.slug}`}>Kembali ke project</Link>
          </p>
        </div>
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
          <DangerZone project={project} />
        </>
      ) : null}

      <Toast message={toast} onDismiss={dismissToast} />
    </section>
  );
}
