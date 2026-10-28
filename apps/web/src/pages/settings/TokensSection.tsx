import { createTokenBody, type CreatedTokenDto, type TokenDto } from "@testpulse/shared";
import { Copy, KeyRound, Loader2 } from "lucide-react";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "../../components/FormField";
import { LoadError } from "../../components/LoadError";
import { api } from "../../lib/api";
import { errorMessage, focusField, serverErrorToForm, validate } from "../../lib/forms";
import { formatDateTime } from "../../lib/format";
import { useLoad } from "../../lib/useLoad";
import { SettingsSection } from "./SettingsSection";

interface Props {
  slug: string;
  /** Nama user yang masuk, untuk baris token yang baru dibuat. */
  meId: string;
  meName: string;
  notify: (message: string) => void;
}

/** Contoh unggah laporan JUnit; URL berasal dari origin halaman sehingga benar di lingkungan mana pun. */
function curlExample(slug: string, token: string): string {
  return [
    `curl -X POST "${window.location.origin}/api/v1/projects/${slug}/runs?branch=main" \\`,
    `  -H "Authorization: Bearer ${token}" \\`,
    `  -H "Content-Type: application/xml" \\`,
    `  --data-binary @junit.xml`,
  ].join("\n");
}

/** Token CI aktif (admin). Nilai token hanya diterima sekali, saat token dibuat. */
export function TokensSection({ slug, meId, meName, notify }: Props) {
  const fetchTokens = useCallback(() => api.tokens.list(slug), [slug]);
  const load = useLoad(fetchTokens);

  return (
    <SettingsSection
      id="tokens"
      title="Token CI"
      description="Token dipakai pipeline CI untuk mengunggah laporan JUnit ke project ini. Maksimal 10 token aktif; token hanya berlaku untuk unggah."
    >
      {load.state === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
          Memuat token…
        </p>
      ) : load.state === "error" ? (
        <LoadError error={load.error} fallback="Gagal memuat token. Coba lagi." onRetry={load.reload} />
      ) : (
        <TokenPanel slug={slug} meId={meId} meName={meName} initial={load.data} notify={notify} />
      )}
    </SettingsSection>
  );
}

function TokenPanel({ slug, meId, meName, initial, notify }: Props & { initial: TokenDto[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [tokens, setTokens] = useState(initial);
  const [name, setName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<CreatedTokenDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (creating) return;

    const parsed = validate(createTokenBody, { name });
    if (!parsed.ok) {
      setFieldErrors(parsed.fields);
      focusField(formRef.current, parsed.fields);
      return;
    }

    setFieldErrors({});
    setCreating(true);
    try {
      const result = await api.tokens.create(slug, parsed.data.name);
      setCreated(result);
      setName("");
      notify("Token dibuat. Salin sekarang; nilainya tidak akan ditampilkan lagi.");
      setTokens((list) => [
        {
          id: result.id,
          name: result.name,
          createdAt: result.createdAt,
          lastUsedAt: null,
          createdBy: { id: meId, name: meName },
        },
        ...list,
      ]);
    } catch (err) {
      const mapped = serverErrorToForm(err, ["name"]);
      setFieldErrors(mapped.fields);
      if (mapped.message !== null) notify(mapped.message);
      else focusField(formRef.current, mapped.fields);
    } finally {
      setCreating(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify("Token disalin.");
    } catch {
      notify("Tidak dapat menyalin otomatis. Salin token secara manual.");
    }
  }

  async function revoke(token: TokenDto) {
    if (revoking) return;
    setRevoking(token.id);
    try {
      await api.tokens.revoke(slug, token.id);
      setTokens((list) => list.filter((t) => t.id !== token.id));
      setCreated((current) => (current?.id === token.id ? null : current));
      notify("Token dicabut.");
    } catch (err) {
      notify(errorMessage(err, "Gagal mencabut token. Coba lagi."));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="grid gap-5">
      <form
        ref={formRef}
        onSubmit={(e) => void create(e)}
        noValidate
        aria-busy={creating}
        className="flex flex-wrap items-start gap-3"
      >
        <div className="min-w-0 flex-[1_1_16rem]">
          <FormField
            name="name"
            label="Nama token"
            testIdPrefix="token"
            hint="Mis. nama pipeline atau repositori."
            value={name}
            onChange={setName}
            error={fieldErrors.name}
          />
        </div>
        <Button type="submit" disabled={creating} className="sm:mt-[1.625rem]" data-testid="token-create">
          <KeyRound aria-hidden="true" />
          {creating ? "Membuat…" : "Buat token"}
        </Button>
      </form>

      {created ? (
        <div className="grid gap-3 rounded-lg border border-primary bg-accent p-4">
          <p className="text-sm">
            Token “{created.name}” siap dipakai. Nilai token hanya ditampilkan sekarang; salin sebelum meninggalkan
            halaman ini. Simpan sebagai rahasia di pipeline CI Anda.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <code
              className="min-w-0 flex-[1_1_16rem] rounded-md border bg-card px-3 py-2 font-mono text-sm break-all"
              data-testid="token-value"
            >
              {created.token}
            </code>
            <Button type="button" variant="outline" onClick={() => void copy(created.token)} data-testid="token-copy">
              <Copy aria-hidden="true" />
              Salin token
            </Button>
          </div>
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">Contoh unggah laporan JUnit</p>
            <pre
              className="m-0 rounded-md border bg-card px-3 py-2 font-mono text-sm break-all whitespace-pre-wrap"
              data-testid="token-curl"
            >
              {curlExample(slug, created.token)}
            </pre>
          </div>
        </div>
      ) : null}

      {tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="token-empty">
          Belum ada token aktif.
        </p>
      ) : (
        <ul className="m-0 grid list-none divide-y divide-border rounded-lg border p-0" data-testid="token-list">
          {tokens.map((token) => (
            <li
              key={token.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3"
              data-testid={`token-row-${token.id}`}
            >
              <div className="grid min-w-0 gap-0.5">
                <span className="text-sm font-medium [overflow-wrap:anywhere]">{token.name}</span>
                <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  Dibuat {formatDateTime(token.createdAt)} oleh {token.createdBy.name} ·{" "}
                  {token.lastUsedAt ? `terakhir dipakai ${formatDateTime(token.lastUsedAt)}` : "belum pernah dipakai"}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={revoking !== null}
                aria-label={`Cabut token ${token.name}`}
                onClick={() => void revoke(token)}
                data-testid={`token-revoke-${token.id}`}
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
