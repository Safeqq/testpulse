import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FormError } from "../components/FormError";
import { LoadError } from "../components/LoadError";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage, useDocumentTitle } from "../lib/forms";
import { formatDateTime } from "../lib/format";
import { loginPathFor, registerPathFor } from "../lib/navigation";
import { ROLE_LABEL } from "../lib/roles";
import { useLoad } from "../lib/useLoad";

/** `/invite/:token`: pratinjau terbuka tanpa login; menerima butuh login (anonim diarahkan masuk lalu kembali ke sini). */
export function InvitePage() {
  useDocumentTitle("Undangan project");
  const { token = "" } = useParams();
  const { status } = useAuth();
  const navigate = useNavigate();
  const fetchPreview = useCallback(() => api.invitations.preview(token), [token]);
  const load = useLoad(fetchPreview);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyMember, setAlreadyMember] = useState(false);

  if (load.state === "loading") {
    return (
      <p role="status" className="loading">
        Memuat undangan…
      </p>
    );
  }

  if (load.state === "error") {
    // 404 (tidak ada/dicabut) dan 410 (dipakai/kedaluwarsa) tidak akan membaik dengan mencoba lagi.
    if (load.error instanceof ApiError && (load.error.status === 404 || load.error.status === 410)) {
      return (
        <section className="empty-state" data-testid="invite-error">
          <h1>Undangan tidak dapat dipakai</h1>
          <p>{load.error.message}</p>
          <Link to="/" className="button button-secondary">
            Ke beranda
          </Link>
        </section>
      );
    }
    return <LoadError error={load.error} fallback="Gagal memuat undangan. Coba lagi." onRetry={load.reload} />;
  }

  const invitation = load.data;
  const invitePath = `/invite/${token}`;

  async function accept() {
    if (accepting) return;
    setError(null);
    setAlreadyMember(false);
    setAccepting(true);
    try {
      const result = await api.invitations.accept(token);
      navigate(`/p/${result.projectSlug}`);
    } catch (err) {
      setError(errorMessage(err, "Gagal menerima undangan. Coba lagi."));
      setAlreadyMember(err instanceof ApiError && err.code === "ALREADY_MEMBER");
      setAccepting(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="invite-title">
      <h1 id="invite-title">Undangan bergabung</h1>

      <div className="invite-preview" data-testid="invite-preview">
        <p>
          Anda diundang bergabung ke project <strong>{invitation.projectName}</strong> sebagai{" "}
          <strong>{ROLE_LABEL[invitation.role]}</strong>.
        </p>
        <p className="field-hint">Berlaku sampai {formatDateTime(invitation.expiresAt)}.</p>
      </div>

      {status === "anonymous" ? (
        <>
          <p className="lead">Masuk atau daftar dulu untuk menerima undangan ini.</p>
          <Link
            to={loginPathFor(invitePath)}
            className="button button-primary button-block"
            data-testid="invite-accept"
          >
            Masuk untuk menerima
          </Link>
          <p className="auth-alt">
            Belum punya akun? <Link to={registerPathFor(invitePath)}>Daftar sekarang</Link>
          </p>
        </>
      ) : (
        <>
          <FormError message={error} />
          {alreadyMember ? (
            <p className="auth-alt">
              <Link to={`/p/${invitation.projectSlug}`}>Buka project</Link>
            </p>
          ) : null}
          <button
            type="button"
            className="button button-primary button-block"
            disabled={status === "loading" || accepting}
            onClick={() => void accept()}
            data-testid="invite-accept"
          >
            {accepting ? "Memproses…" : "Terima undangan"}
          </button>
        </>
      )}
    </section>
  );
}
