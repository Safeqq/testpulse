import { ROLES, type MemberDto, type Role } from "@testpulse/shared";
import { useCallback, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LoadError } from "../../components/LoadError";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/forms";
import { ROLE_LABEL } from "../../lib/roles";
import { useLoad } from "../../lib/useLoad";

interface Props {
  slug: string;
  meId: string;
  isAdmin: boolean;
  notify: (message: string) => void;
  /** Dipanggil saat role user yang sedang masuk berubah, agar halaman menyesuaikan bagian admin. */
  onOwnRoleChanged: (role: Role) => void;
}

/** Daftar anggota: semua anggota melihatnya; admin mengubah role/mengeluarkan; siapa pun bisa keluar sendiri. */
export function MembersSection({ slug, meId, isAdmin, notify, onOwnRoleChanged }: Props) {
  const fetchMembers = useCallback(() => api.members.list(slug), [slug]);
  const load = useLoad(fetchMembers);

  return (
    <section className="card" aria-labelledby="members-title">
      <h2 id="members-title">Anggota</h2>
      {load.state === "loading" ? (
        <p role="status" className="loading">
          Memuat anggota…
        </p>
      ) : load.state === "error" ? (
        <LoadError error={load.error} fallback="Gagal memuat anggota. Coba lagi." onRetry={load.reload} />
      ) : (
        <MemberList
          slug={slug}
          meId={meId}
          isAdmin={isAdmin}
          initial={load.data}
          notify={notify}
          onOwnRoleChanged={onOwnRoleChanged}
        />
      )}
    </section>
  );
}

interface ListProps extends Props {
  initial: MemberDto[];
}

function MemberList({ slug, meId, isAdmin, initial, notify, onOwnRoleChanged }: ListProps) {
  const navigate = useNavigate();
  const [members, setMembers] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  async function changeRole(member: MemberDto, role: Role) {
    if (busy || role === member.role) return;
    setBusy(member.userId);
    try {
      const updated = await api.members.updateRole(slug, member.userId, { role });
      setMembers((list) => list.map((m) => (m.userId === updated.userId ? updated : m)));
      if (updated.userId === meId) onOwnRoleChanged(updated.role);
      notify(`Peran ${updated.name} diubah menjadi ${ROLE_LABEL[updated.role]}.`);
    } catch (err) {
      notify(errorMessage(err, "Gagal mengubah peran. Coba lagi."));
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(member: MemberDto) {
    if (busy) return;
    setBusy(member.userId);
    try {
      await api.members.remove(slug, member.userId);
      setMembers((list) => list.filter((m) => m.userId !== member.userId));
      notify(`${member.name} dikeluarkan dari project.`);
    } catch (err) {
      notify(errorMessage(err, "Gagal mengeluarkan anggota. Coba lagi."));
    } finally {
      setBusy(null);
    }
  }

  async function leave() {
    if (leaving) return;
    setLeaving(true);
    try {
      await api.members.remove(slug, meId);
      navigate("/");
    } catch (err) {
      notify(errorMessage(err, "Gagal keluar dari project. Coba lagi."));
      setLeaving(false);
    }
  }

  return (
    <>
      <ul className="member-list" data-testid="member-list">
        {members.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            isSelf={member.userId === meId}
            isAdmin={isAdmin}
            disabled={busy !== null}
            onChangeRole={(role) => void changeRole(member, role)}
            onRemove={() => void removeMember(member)}
          />
        ))}
      </ul>
      <div className="leave-box">
        <button
          type="button"
          className="button button-danger-outline"
          disabled={leaving}
          onClick={() => void leave()}
          data-testid="leave-project"
        >
          {leaving ? "Memproses…" : "Keluar dari project"}
        </button>
        <p className="field-hint">Anda kehilangan akses ke project privat ini sampai diundang kembali.</p>
      </div>
    </>
  );
}

interface RowProps {
  member: MemberDto;
  isSelf: boolean;
  isAdmin: boolean;
  disabled: boolean;
  onChangeRole: (role: Role) => void;
  onRemove: () => void;
}

function MemberRow({ member, isSelf, isAdmin, disabled, onChangeRole, onRemove }: RowProps) {
  const selectId = useId();
  return (
    <li className="member-row" data-testid={`member-row-${member.userId}`}>
      <div className="member-info">
        <span className="member-name">
          {member.name}
          {isSelf ? <span className="chip">Anda</span> : null}
        </span>
        <span className="member-email">{member.email}</span>
      </div>
      <div className="member-actions">
        {isAdmin ? (
          <>
            <label htmlFor={selectId} className="visually-hidden">
              Peran {member.name}
            </label>
            <select
              id={selectId}
              value={member.role}
              disabled={disabled}
              onChange={(e) => onChangeRole(e.target.value as Role)}
              data-testid={`member-role-${member.userId}`}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
            {isSelf ? null : (
              <button
                type="button"
                className="button button-secondary"
                disabled={disabled}
                aria-label={`Keluarkan ${member.name}`}
                onClick={onRemove}
                data-testid={`member-remove-${member.userId}`}
              >
                Keluarkan
              </button>
            )}
          </>
        ) : (
          <span className="chip chip-role">{ROLE_LABEL[member.role]}</span>
        )}
      </div>
    </li>
  );
}
