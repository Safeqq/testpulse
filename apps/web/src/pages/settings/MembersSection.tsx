import { ROLES, type MemberDto, type Role } from "@testpulse/shared";
import { Loader2, LogOut } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NativeSelect } from "@/components/NativeSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { LoadError } from "../../components/LoadError";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/forms";
import { ROLE_LABEL } from "../../lib/roles";
import { useLoad } from "../../lib/useLoad";
import { SettingsSection } from "./SettingsSection";

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
    <SettingsSection
      id="members"
      title="Anggota"
      description={isAdmin ? "Ubah peran anggota atau keluarkan dari project." : "Anggota project ini dan perannya."}
    >
      {load.state === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
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
    </SettingsSection>
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
      <ul className="m-0 grid list-none divide-y divide-border rounded-lg border p-0" data-testid="member-list">
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

      <Separator className="my-5" />
      <div className="grid justify-items-start gap-2">
        <Button
          type="button"
          variant="outline"
          className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={leaving}
          onClick={() => void leave()}
          data-testid="leave-project"
        >
          <LogOut aria-hidden="true" />
          {leaving ? "Memproses…" : "Keluar dari project"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Anda kehilangan akses ke project privat ini sampai diundang kembali.
        </p>
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
    <li
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3"
      data-testid={`member-row-${member.userId}`}
    >
      <div className="grid min-w-0 gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium [overflow-wrap:anywhere]">
          {member.name}
          {isSelf ? <Badge variant="outline">Anda</Badge> : null}
        </span>
        <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{member.email}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isAdmin ? (
          <>
            <label htmlFor={selectId} className="sr-only">
              Peran {member.name}
            </label>
            <NativeSelect
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
            </NativeSelect>
            {isSelf ? null : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                aria-label={`Keluarkan ${member.name}`}
                onClick={onRemove}
                data-testid={`member-remove-${member.userId}`}
              >
                Keluarkan
              </Button>
            )}
          </>
        ) : (
          <Badge variant="secondary">{ROLE_LABEL[member.role]}</Badge>
        )}
      </div>
    </li>
  );
}
