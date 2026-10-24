import type { Role } from "@testpulse/shared";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useDocumentTitle } from "../lib/forms";
import { useLoad } from "../lib/useLoad";

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Gagal memuat project. Coba lagi.";
}

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", tester: "Tester", viewer: "Viewer" };

const listProjects = () => api.projects.list();

/** Beranda: daftar project milik user yang masuk (dibungkus RequireAuth di App). */
export function ProjectsPage() {
  useDocumentTitle("Project saya");
  const load = useLoad(listProjects);

  return (
    <section aria-labelledby="projects-title">
      <div className="page-header">
        <div>
          <h1 id="projects-title">Project saya</h1>
          <p className="lead">Project tempat Anda menjadi anggota.</p>
        </div>
        <Link to="/projects/new" className="button button-primary" data-testid="new-project">
          Buat project
        </Link>
      </div>

      {load.state === "loading" ? (
        <p role="status" className="loading">
          Memuat project…
        </p>
      ) : load.state === "error" ? (
        <div role="alert" className="form-error">
          <p className="alert-text">{errorMessage(load.error)}</p>
          <button type="button" className="button button-secondary" onClick={load.reload}>
            Coba lagi
          </button>
        </div>
      ) : load.data.length === 0 ? (
        <div className="empty-state" data-testid="empty-projects">
          <h2>Belum ada project</h2>
          <p>Buat project pertama Anda untuk mulai mengumpulkan hasil test tim.</p>
        </div>
      ) : (
        <ul className="project-list" data-testid="project-list">
          {load.data.map((project) => (
            <li key={project.id} className="project-item" data-testid={`project-item-${project.slug}`}>
              <div className="project-item-main">
                <Link to={`/p/${project.slug}`} className="project-item-name">
                  {project.name}
                </Link>
                <span className="project-item-slug">/p/{project.slug}</span>
              </div>
              <div className="project-item-meta">
                <span className="chip">{project.visibility === "public" ? "Publik" : "Privat"}</span>
                {project.myRole ? <span className="chip chip-role">{ROLE_LABEL[project.myRole]}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
