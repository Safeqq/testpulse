import { INVITABLE_ROLES, type CreatedInvitationDto, type InvitableRole, type InvitationDto } from "@testpulse/shared";
import { useCallback, useId, useState } from "react";
import { LoadError } from "../../components/LoadError";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/forms";
import { formatDateTime } from "../../lib/format";
import { ROLE_LABEL } from "../../lib/roles";
import { useLoad } from "../../lib/useLoad";

interface Props {
  slug: string;
  /** Nama user yang masuk, untuk baris undangan yang baru dibuat. */
  meId: string;
  meName: string;
  notify: (message: string) => void;
}

/** Undangan aktif (admin). URL lengkap hanya diterima sekali, saat undangan dibuat. */
export function InvitationsSection({ slug, meId, meName, notify }: Props) {
  const fetchInvitations = useCallback(() => api.invitations.list(slug), [slug]);
  const load = useLoad(fetchInvitations);

  return (
    <section className="card" aria-labelledby="invitations-title">
      <h2 id="invitations-title">Undangan</h2>
      {load.state === "loading" ? (
        <p role="status" className="loading">
          Memuat undangan…
        </p>
      ) : load.state === "error" ? (
        <LoadError error={load.error} fallback="Gagal memuat undangan. Coba lagi." onRetry={load.reload} />
      ) : (
        <InvitationPanel slug={slug} meId={meId} meName={meName} initial={load.data} notify={notify} />
      )}
    </section>
  );
}

function InvitationPanel({ slug, meId, meName, initial, notify }: Props & { initial: InvitationDto[] }) {
  const roleId = useId();
  const [invitations, setInvitations] = useState(initial);
  const [role, setRole] = useState<InvitableRole>("viewer");
  const [created, setCreated] = useState<CreatedInvitationDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      const result = await api.invitations.create(slug, { role });
      setCreated(result);
      setInvitations((list) => [
        {
          id: result.id,
          role: result.role,
          expiresAt: result.expiresAt,
          createdAt: new Date().toISOString(),
          createdBy: { id: meId, name: meName },
        },
        ...list,
      ]);
    } catch (err) {
      notify(errorMessage(err, "Gagal membuat undangan. Coba lagi."));
    } finally {
      setCreating(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      notify("Tautan undangan disalin.");
    } catch {
      notify("Tidak dapat menyalin otomatis. Salin tautan secara manual.");
    }
  }

  async function revoke(invitation: InvitationDto) {
    if (revoking) return;
    setRevoking(invitation.id);
    try {
      await api.invitations.revoke(slug, invitation.id);
      setInvitations((list) => list.filter((i) => i.id !== invitation.id));
      setCreated((current) => (current?.id === invitation.id ? null : current));
      notify("Undangan dicabut.");
    } catch (err) {
      notify(errorMessage(err, "Gagal mencabut undangan. Coba lagi."));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <>
      <p className="section-lead">
        Undangan berlaku 7 hari dan hanya bisa dipakai satu kali. Tester dapat mengirim hasil test; Viewer hanya dapat
        melihat.
      </p>

      <div className="invite-form">
        <div className="field">
          <label htmlFor={roleId}>Peran undangan</label>
          <select
            id={roleId}
            value={role}
            onChange={(e) => setRole(e.target.value as InvitableRole)}
            data-testid="invite-role"
          >
            {INVITABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="button button-primary"
          disabled={creating}
          onClick={() => void create()}
          data-testid="invite-create"
        >
          {creating ? "Membuat…" : "Buat undangan"}
        </button>
      </div>

      {created ? (
        <div className="invite-created">
          <p className="invite-created-note">
            Tautan undangan {ROLE_LABEL[created.role]} siap dibagikan. Tautan lengkap hanya ditampilkan sekarang; salin
            sebelum meninggalkan halaman ini.
          </p>
          <div className="invite-created-row">
            <code className="invite-url" data-testid="invite-url">
              {created.url}
            </code>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void copy(created.url)}
              data-testid="invite-copy"
            >
              Salin tautan
            </button>
          </div>
        </div>
      ) : null}

      {invitations.length === 0 ? (
        <p className="empty-note" data-testid="invite-empty">
          Belum ada undangan aktif.
        </p>
      ) : (
        <ul className="invite-list" data-testid="invite-list">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="invite-row" data-testid={`invite-row-${invitation.id}`}>
              <div className="invite-info">
                <span className="chip chip-role">{ROLE_LABEL[invitation.role]}</span>
                <span className="invite-meta">
                  Berlaku sampai {formatDateTime(invitation.expiresAt)} · dibuat oleh {invitation.createdBy.name}
                </span>
              </div>
              <button
                type="button"
                className="button button-secondary"
                disabled={revoking !== null}
                aria-label={`Cabut undangan ${ROLE_LABEL[invitation.role]} yang berlaku sampai ${formatDateTime(invitation.expiresAt)}`}
                onClick={() => void revoke(invitation)}
                data-testid={`invite-revoke-${invitation.id}`}
              >
                Cabut
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
