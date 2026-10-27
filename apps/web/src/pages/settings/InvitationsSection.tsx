import { INVITABLE_ROLES, type CreatedInvitationDto, type InvitableRole, type InvitationDto } from "@testpulse/shared";
import { Copy, Link2, Loader2 } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { NativeSelect } from "@/components/NativeSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { LoadError } from "../../components/LoadError";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/forms";
import { formatDateTime } from "../../lib/format";
import { ROLE_LABEL } from "../../lib/roles";
import { useLoad } from "../../lib/useLoad";
import { SettingsSection } from "./SettingsSection";

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
    <SettingsSection
      id="invitations"
      title="Undangan"
      description="Undangan berlaku 7 hari dan hanya bisa dipakai satu kali. Tester dapat mengirim hasil test; Viewer hanya dapat melihat."
    >
      {load.state === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
          Memuat undangan…
        </p>
      ) : load.state === "error" ? (
        <LoadError error={load.error} fallback="Gagal memuat undangan. Coba lagi." onRetry={load.reload} />
      ) : (
        <InvitationPanel slug={slug} meId={meId} meName={meName} initial={load.data} notify={notify} />
      )}
    </SettingsSection>
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
      notify(`Undangan ${ROLE_LABEL[result.role]} dibuat. Salin tautannya sebelum meninggalkan halaman ini.`);
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
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={roleId}>Peran undangan</Label>
          <NativeSelect
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
          </NativeSelect>
        </div>
        <Button type="button" disabled={creating} onClick={() => void create()} data-testid="invite-create">
          <Link2 aria-hidden="true" />
          {creating ? "Membuat…" : "Buat undangan"}
        </Button>
      </div>

      {created ? (
        <div className="grid gap-3 rounded-lg border border-primary bg-accent p-4">
          <p className="text-sm">
            Tautan undangan {ROLE_LABEL[created.role]} siap dibagikan. Tautan lengkap hanya ditampilkan sekarang; salin
            sebelum meninggalkan halaman ini.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <code
              className="min-w-0 flex-[1_1_16rem] rounded-md border bg-card px-3 py-2 font-mono text-sm break-all"
              data-testid="invite-url"
            >
              {created.url}
            </code>
            <Button type="button" variant="outline" onClick={() => void copy(created.url)} data-testid="invite-copy">
              <Copy aria-hidden="true" />
              Salin tautan
            </Button>
          </div>
        </div>
      ) : null}

      {invitations.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="invite-empty">
          Belum ada undangan aktif.
        </p>
      ) : (
        <ul className="m-0 grid list-none divide-y divide-border rounded-lg border p-0" data-testid="invite-list">
          {invitations.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3"
              data-testid={`invite-row-${invitation.id}`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <Badge variant="secondary">{ROLE_LABEL[invitation.role]}</Badge>
                <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  Berlaku sampai {formatDateTime(invitation.expiresAt)} · dibuat oleh {invitation.createdBy.name}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={revoking !== null}
                aria-label={`Cabut undangan ${ROLE_LABEL[invitation.role]} yang berlaku sampai ${formatDateTime(invitation.expiresAt)}`}
                onClick={() => void revoke(invitation)}
                data-testid={`invite-revoke-${invitation.id}`}
              >
                Cabut
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
