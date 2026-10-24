import type { Role } from "@testpulse/shared";
import { useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useDocumentTitle } from "../lib/forms";
import { loginPathFor } from "../lib/navigation";
import { useLoad } from "../lib/useLoad";

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", tester: "Tester", viewer: "Viewer" };

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
      <p role="status" className="loading">
        Memuat project…
      </p>
    );
  }

  if (notFound) {
    return (
      <section className="empty-state" data-testid="project-not-found">
        <h1>Project tidak ditemukan</h1>
        <p>Project tidak ditemukan. Jika ini project privat, silakan masuk.</p>
        {status === "anonymous" ? (
          <Link to={loginPathFor(`/p/${slug}`)} className="button button-primary">
            Masuk
          </Link>
        ) : (
          <Link to="/" className="button button-secondary">
            Ke project saya
          </Link>
        )}
      </section>
    );
  }

  if (load.state === "error") {
    const message = load.error instanceof ApiError ? load.error.message : "Gagal memuat project. Coba lagi.";
    return (
      <div role="alert" className="form-error">
        <p className="alert-text">{message}</p>
        <button type="button" className="button button-secondary" onClick={load.reload}>
          Coba lagi
        </button>
      </div>
    );
  }

  const project = load.data;
  const isMember = project.myRole !== null;

  return (
    <section aria-labelledby="project-title">
      <div className="page-header">
        <div>
          <h1 id="project-title" data-testid="project-title">
            {project.name}
          </h1>
          <div className="project-meta">
            <span className="project-item-slug">/p/{project.slug}</span>
            {!isMember && project.visibility === "public" ? (
              <span className="chip chip-public" data-testid="public-badge">
                Project publik · hanya-baca
              </span>
            ) : (
              <span className="chip">{project.visibility === "public" ? "Publik" : "Privat"}</span>
            )}
            {project.myRole ? <span className="chip chip-role">Peran Anda: {ROLE_LABEL[project.myRole]}</span> : null}
          </div>
        </div>
        <div className="page-actions">
          {isMember ? (
            <Link to={`/p/${project.slug}/settings`} className="button button-secondary" data-testid="settings-link">
              Pengaturan
            </Link>
          ) : status === "anonymous" ? (
            <Link to={loginPathFor(`/p/${project.slug}`)} className="button button-primary" data-testid="project-login">
              Masuk
            </Link>
          ) : null}
        </div>
      </div>

      <div className="empty-state" data-testid="empty-results">
        <h2>Belum ada hasil test</h2>
        <p>Hasil test akan tampil di sini setelah fitur pengiriman hasil tersedia di tahap berikutnya.</p>
      </div>
    </section>
  );
}
