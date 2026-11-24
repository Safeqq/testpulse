import { createCycleBody, MAX_CYCLE_LINKS, MAX_ENVIRONMENTS, type TeamCycleDto } from "@testpulse/shared";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { useCallback, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FormError } from "@/components/FormError";
import { FormField } from "@/components/FormField";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { focusField, serverErrorToForm } from "@/lib/forms";
import { useLoad } from "@/lib/useLoad";
import { ProjectFrame } from "./ProjectFrame";

const SCALAR_FIELDS = ["title", "summary", "instructions", "inScope", "outOfScope", "environments", "appVersion", "endsAt", "links"] as const;
const VERSION_LIST_ID = "cycle-version-suggestions";

interface LinkRow {
  key: number;
  url: string;
  label: string;
}

interface Draft {
  title: string;
  summary: string;
  links: LinkRow[];
  instructions: string;
  inScope: string;
  outOfScope: string;
  environments: string[];
  appVersion: string;
  endsAt: string;
}

let nextKey = 1;
const linkRow = (url = "", label = ""): LinkRow => ({ key: nextKey++, url, label });

/** `datetime-local` memakai waktu lokal tanpa zona; nilai disimpan dan dikirim sebagai ISO UTC. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function draftOf(cycle: TeamCycleDto | null): Draft {
  return {
    title: cycle?.title ?? "",
    summary: cycle?.summary ?? "",
    links: cycle ? cycle.links.map((l) => linkRow(l.url, l.label)) : [linkRow()],
    instructions: cycle?.instructions ?? "",
    inScope: cycle?.inScope ?? "",
    outOfScope: cycle?.outOfScope ?? "",
    environments: cycle?.environments ?? [],
    appVersion: cycle?.appVersion ?? "",
    endsAt: toLocalInput(cycle?.endsAt ?? null),
  };
}

/** `/p/:slug/cycles/new` dan `/p/:slug/cycles/:number/edit` (admin), spec Tahap 5 §9.3. */
export function CycleFormPage() {
  const { slug = "", number } = useParams();
  return (
    <ProjectFrame slug={slug} title={number ? "Ubah cycle" : "Buat cycle"} tab="crowd">
      {(project) =>
        project.myRole === "admin" ? (
          <FormLoader slug={project.slug} number={number ? Number(number) : null} />
        ) : (
          <p className="m-0 text-muted-foreground" data-testid="cycle-form-forbidden">
            Hanya admin project yang bisa membuat atau mengubah cycle.
          </p>
        )
      }
    </ProjectFrame>
  );
}

function FormLoader({ slug, number }: { slug: string; number: number | null }) {
  const cycle = useLoad(useCallback(() => (number === null ? Promise.resolve(null) : api.cycles.get(slug, number)), [slug, number]));
  const versions = useLoad(useCallback(() => api.results.versions(slug).catch(() => []), [slug]));
  if (cycle.state === "loading") return <Loading label="Memuat cycle…" />;
  if (cycle.state === "error") return <LoadError error={cycle.error} fallback="Gagal memuat cycle. Coba lagi." onRetry={cycle.reload} />;
  const suggestions = versions.state === "ready" ? versions.data.map((v) => v.version) : [];
  return <CycleForm key={cycle.data?.version ?? 0} slug={slug} existing={cycle.data} suggestions={suggestions} reload={cycle.reload} />;
}

function CycleForm({
  slug,
  existing,
  suggestions,
  reload,
}: {
  slug: string;
  existing: TeamCycleDto | null;
  suggestions: string[];
  reload: () => void;
}) {
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const ids = { env: useId(), endsAt: useId(), version: useId(), links: useId() };
  const [draft, setDraft] = useState<Draft>(() => draftOf(existing));
  const [envDraft, setEnvDraft] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const cyclesPath = `/p/${encodeURIComponent(slug)}/cycles`;

  function addEnvironment() {
    const label = envDraft.trim();
    if (label === "") return;
    if (draft.environments.some((e) => e.toLowerCase() === label.toLowerCase())) return setEnvDraft("");
    if (draft.environments.length >= MAX_ENVIRONMENTS) {
      return setFieldErrors((f) => ({ ...f, environments: `Maksimal ${MAX_ENVIRONMENTS} lingkungan target` }));
    }
    set("environments", [...draft.environments, label]);
    setEnvDraft("");
  }

  function onEnvKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addEnvironment();
    }
  }

  function moveLink(index: number, delta: -1 | 1) {
    const next = [...draft.links];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    set("links", next);
  }

  function fail(fields: Record<string, string>, message: string | null) {
    setFieldErrors(fields);
    setFormError(message);
    focusField(formRef.current, fields);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const body = {
      title: draft.title,
      summary: draft.summary,
      links: draft.links.map((l) => ({ url: l.url.trim(), label: l.label })),
      instructions: draft.instructions,
      inScope: draft.inScope,
      outOfScope: draft.outOfScope,
      environments: draft.environments,
      appVersion: draft.appVersion.trim() === "" ? null : draft.appVersion.trim(),
      // `datetime-local` membuang detik: bila kolom tidak diubah, kirim nilai tersimpan apa adanya agar cycle yang sudah
      // lewat waktu berakhirnya tetap bisa diedit (server hanya menolak endsAt lampau yang diubah).
      endsAt:
        existing && draft.endsAt === toLocalInput(existing.endsAt)
          ? existing.endsAt
          : draft.endsAt === ""
            ? null
            : new Date(draft.endsAt).toISOString(),
    };
    const parsed = createCycleBody.safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.map(String).join(".") || "form"] ??= issue.message;
      return fail(fields, null);
    }
    setFieldErrors({});
    setFormError(null);
    setConflict(false);
    setSubmitting(true);
    try {
      const saved = existing
        ? await api.cycles.update(slug, existing.number, { version: existing.version, ...parsed.data })
        : await api.cycles.create(slug, parsed.data);
      navigate(`${cyclesPath}/${saved.number}`);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.code === "CYCLE_CONFLICT") return setConflict(true);
      const serverKeys = err instanceof ApiError ? Object.keys(err.fields ?? {}) : [];
      const known = serverKeys.filter((key) => (SCALAR_FIELDS as readonly string[]).includes(key.split(".")[0]!));
      const mapped = serverErrorToForm(err, known);
      fail(mapped.fields, mapped.message);
    }
  }

  return (
    <section aria-labelledby="cycle-form-title" className="grid min-w-0 grid-cols-1 gap-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link to={cyclesPath}>Crowdtesting</Link>
      </nav>
      <h1 id="cycle-form-title" className="text-2xl font-semibold tracking-tight">
        {existing ? "Ubah cycle" : "Buat cycle"}
      </h1>
      {conflict ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm" data-testid="cycle-conflict">
          <span className="font-medium">Cycle ini baru saja diubah orang lain. Isian Anda belum disimpan.</span>
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            Muat versi terbaru
          </Button>
        </div>
      ) : null}
      <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={submitting} className="grid min-w-0 gap-5" data-testid="cycle-form">
        <FormError message={formError} />
        <FormField name="title" label="Judul" value={draft.title} onChange={(v) => set("title", v)} error={fieldErrors.title} testIdPrefix="cycle" />
        <FormField
          name="summary"
          label="Ringkasan"
          value={draft.summary}
          onChange={(v) => set("summary", v)}
          error={fieldErrors.summary}
          testIdPrefix="cycle"
          hint={`Tampil di direktori publik. ${draft.summary.length}/280 karakter.`}
        />

        <fieldset className="grid min-w-0 gap-3" aria-describedby={`${ids.links}-hint`}>
          <legend className="text-sm font-medium">Link aplikasi yang diuji</legend>
          <p id={`${ids.links}-hint`} className="m-0 text-sm text-muted-foreground">
            1–{MAX_CYCLE_LINKS} link http/https (mis. web staging, halaman unduh APK). Tanpa username/password di URL.
          </p>
          {fieldErrors.links ? (
            <p className="m-0 text-sm font-medium text-destructive" data-testid="field-error-links">
              {fieldErrors.links}
            </p>
          ) : null}
          {draft.links.map((link, i) => (
            <div key={link.key} className="grid min-w-0 grid-cols-1 gap-2 rounded-md border bg-card p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor={`link-url-${link.key}`}>URL</Label>
                <Input
                  id={`link-url-${link.key}`}
                  name={`links.${i}.url`}
                  value={link.url}
                  inputMode="url"
                  onChange={(e) => set("links", draft.links.map((l) => (l.key === link.key ? { ...l, url: e.target.value } : l)))}
                  aria-invalid={fieldErrors[`links.${i}.url`] ? true : undefined}
                  data-testid={`cycle-link-${i}-url`}
                />
                {fieldErrors[`links.${i}.url`] ? <p className="m-0 text-sm font-medium text-destructive">{fieldErrors[`links.${i}.url`]}</p> : null}
              </div>
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor={`link-label-${link.key}`}>Label</Label>
                <Input
                  id={`link-label-${link.key}`}
                  name={`links.${i}.label`}
                  value={link.label}
                  onChange={(e) => set("links", draft.links.map((l) => (l.key === link.key ? { ...l, label: e.target.value } : l)))}
                  aria-invalid={fieldErrors[`links.${i}.label`] ? true : undefined}
                  data-testid={`cycle-link-${i}-label`}
                />
                {fieldErrors[`links.${i}.label`] ? <p className="m-0 text-sm font-medium text-destructive">{fieldErrors[`links.${i}.label`]}</p> : null}
              </div>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="icon" aria-label={`Pindah link ${i + 1} ke atas`} disabled={i === 0} onClick={() => moveLink(i, -1)}>
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Pindah link ${i + 1} ke bawah`} disabled={i === draft.links.length - 1} onClick={() => moveLink(i, 1)}>
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Hapus link ${i + 1}`} disabled={draft.links.length === 1} onClick={() => set("links", draft.links.filter((l) => l.key !== link.key))}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button type="button" variant="outline" size="sm" disabled={draft.links.length >= MAX_CYCLE_LINKS} onClick={() => set("links", [...draft.links, linkRow()])} data-testid="cycle-link-add">
              <Plus aria-hidden="true" />
              Tambah link
            </Button>
          </div>
        </fieldset>

        <MarkdownEditor name="instructions" label="Instruksi" value={draft.instructions} onChange={(v) => set("instructions", v)} error={fieldErrors.instructions} testId="cycle-instructions" rows={6} hint="Alur yang perlu dicoba, akun uji, dan hal yang perlu diperhatikan tester." />
        <div className="grid min-w-0 gap-5 md:grid-cols-2">
          <MarkdownEditor name="inScope" label="Yang diuji" value={draft.inScope} onChange={(v) => set("inScope", v)} error={fieldErrors.inScope} testId="cycle-in-scope" rows={4} />
          <MarkdownEditor name="outOfScope" label="Di luar cakupan" value={draft.outOfScope} onChange={(v) => set("outOfScope", v)} error={fieldErrors.outOfScope} testId="cycle-out-scope" rows={4} />
        </div>

        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={ids.env}>Lingkungan target</Label>
          {draft.environments.length > 0 ? (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="cycle-envs">
              {draft.environments.map((env) => (
                <li key={env} className="inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-sm">
                  <span className="[overflow-wrap:anywhere]">{env}</span>
                  <button type="button" className="rounded-sm p-0.5 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-hidden" aria-label={`Hapus lingkungan ${env}`} onClick={() => set("environments", draft.environments.filter((e) => e !== env))}>
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex min-w-0 flex-wrap gap-2">
            <Input id={ids.env} name="environments" value={envDraft} maxLength={40} onChange={(e) => setEnvDraft(e.target.value)} onKeyDown={onEnvKey} className="min-w-0 flex-1 sm:max-w-xs" data-testid="cycle-env-input" />
            <Button type="button" variant="outline" onClick={addEnvironment} data-testid="cycle-env-add">
              Tambah
            </Button>
          </div>
          <p className="m-0 text-sm text-muted-foreground">Mis. “Chrome desktop”, “Android”. Maksimal {MAX_ENVIRONMENTS}.</p>
          {fieldErrors.environments ? <p className="m-0 text-sm font-medium text-destructive" data-testid="field-error-environments">{fieldErrors.environments}</p> : null}
        </div>

        <div className="grid min-w-0 gap-5 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={ids.version}>Versi aplikasi (opsional)</Label>
            <Input id={ids.version} name="appVersion" value={draft.appVersion} maxLength={50} list={VERSION_LIST_ID} autoComplete="off" onChange={(e) => set("appVersion", e.target.value)} aria-invalid={fieldErrors.appVersion ? true : undefined} data-testid="cycle-app-version" />
            <datalist id={VERSION_LIST_ID}>
              {suggestions.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            {fieldErrors.appVersion ? <p className="m-0 text-sm font-medium text-destructive">{fieldErrors.appVersion}</p> : null}
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor={ids.endsAt}>Berakhir (opsional)</Label>
            <Input id={ids.endsAt} name="endsAt" type="datetime-local" value={draft.endsAt} onChange={(e) => set("endsAt", e.target.value)} aria-invalid={fieldErrors.endsAt ? true : undefined} data-testid="cycle-ends-at" />
            {fieldErrors.endsAt ? <p className="m-0 text-sm font-medium text-destructive" data-testid="field-error-endsAt">{fieldErrors.endsAt}</p> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={submitting} data-testid="cycle-save">
            {submitting ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
            {existing ? "Simpan perubahan" : "Buat cycle (draf)"}
          </Button>
          <Button asChild variant="ghost">
            <Link to={existing ? `${cyclesPath}/${existing.number}` : cyclesPath}>Batal</Link>
          </Button>
        </div>
      </form>
    </section>
  );
}
