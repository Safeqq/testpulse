import {
  BUG_PRIORITIES,
  BUG_SEVERITIES,
  createBugBody,
  type BugPriority,
  type BugSeverity,
  type ProjectDto,
} from "@testpulse/shared";
import { ArrowLeft, Loader2, LockKeyhole } from "lucide-react";
import { useCallback, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { BugLabelsInput } from "@/components/BugLabelsInput";
import { BugLinksInput, type LinkDraft } from "@/components/BugLinksInput";
import { EmptyState } from "@/components/EmptyState";
import { FormError } from "@/components/FormError";
import { FormField } from "@/components/FormField";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { NativeSelect } from "@/components/NativeSelect";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { BUG_PRIORITY_LABEL, BUG_SEVERITY_LABEL } from "@/lib/bugs";
import { focusField, serverErrorToForm } from "@/lib/forms";
import { loginPathFor } from "@/lib/navigation";
import { useLoad } from "@/lib/useLoad";
import { loadBugReportSource, type BugReportPrefill } from "./bugReportSource";
import { BACK_LINK_CLASS, ProjectFrame } from "./ProjectFrame";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCALAR_FIELDS = ["title", "description", "priority", "severity", "assigneeId"] as const;

/** `/p/:slug/bugs/new`: formulir bug baru; `?testCaseId=&runId=` mengisinya dari test gagal (spec Tahap 3 §7.5). */
export function BugNewPage() {
  const { slug = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title="Buat bug" tab="bug">
      {(project) => <NewBug project={project} />}
    </ProjectFrame>
  );
}

function NewBug({ project }: { project: ProjectDto }) {
  const { pathname, search } = useLocation();
  const [params] = useSearchParams();
  const canWrite = project.myRole === "tester" || project.myRole === "admin";
  const testCaseId = params.get("testCaseId");
  // `runId` tanpa test ditolak server, jadi diabaikan; nilai yang bukan UUID juga (server memvalidasi sisanya).
  const validTestCaseId = testCaseId !== null && UUID.test(testCaseId) ? testCaseId : undefined;
  const runParam = params.get("runId");
  const runId = validTestCaseId && runParam !== null && UUID.test(runParam) ? runParam : undefined;

  if (!canWrite) {
    return (
      <EmptyState icon={LockKeyhole} title="Tidak bisa membuat bug" headingLevel="h1" data-testid="bug-new-forbidden">
        <p>
          {project.myRole === "viewer"
            ? "Peran viewer hanya bisa melihat bug. Minta admin project mengubah peranmu menjadi tester untuk melaporkan bug."
            : "Hanya tester dan admin project ini yang bisa membuat bug. Masuk dengan akun anggota untuk melanjutkan."}
        </p>
        {project.myRole === null ? (
          <Link
            to={loginPathFor(`${pathname}${search}`)}
            className="mt-2 inline-block rounded-sm font-medium text-link underline underline-offset-4 outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            Masuk
          </Link>
        ) : null}
      </EmptyState>
    );
  }

  return validTestCaseId ? (
    <WithPrefill key={`${validTestCaseId}:${runId ?? ""}`} slug={project.slug} testCaseId={validTestCaseId} runId={runId} />
  ) : (
    <BugForm slug={project.slug} prefill={null} />
  );
}

/** Memuat data test (dan pesan error run) lebih dulu supaya formulir langsung tampil terisi. */
function WithPrefill({ slug, testCaseId, runId }: { slug: string; testCaseId: string; runId: string | undefined }) {
  const fetchPrefill = useCallback(() => loadBugReportSource(slug, testCaseId, runId), [slug, testCaseId, runId]);
  const load = useLoad(fetchPrefill);
  if (load.state === "loading") return <Loading label="Menyiapkan formulir…" />;
  if (load.state === "error") {
    return (
      <div className="grid min-w-0 gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Buat bug</h1>
        <LoadError error={load.error} fallback="Gagal memuat data test. Coba lagi." onRetry={load.reload} />
        <div>
          <Link to={`/p/${encodeURIComponent(slug)}/bugs/new`} className={BACK_LINK_CLASS}>
            Buat bug tanpa tautan test
          </Link>
        </div>
      </div>
    );
  }
  return <BugForm slug={slug} prefill={load.data} />;
}

/** Kunci error server untuk label (`labels.2`) dipusatkan ke kolom label; selebihnya dipakai apa adanya. */
function normalizeKey(key: string): string {
  return key.startsWith("labels.") ? "labels" : key;
}

/** Peta kunci `links.<i>` (indeks daftar terkirim) ke indeks baris formulir; baris kosong tidak ikut terkirim. */
function remapLinkKeys(fields: Record<string, string>, rowIndexes: number[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(fields)) {
    const match = /^links\.(\d+)(\..+)?$/.exec(key);
    const mapped = match ? `links.${rowIndexes[Number(match[1])] ?? match[1]}${match[2] ?? ""}` : normalizeKey(key);
    out[mapped] ??= message;
  }
  return out;
}

function BugForm({ slug, prefill }: { slug: string; prefill: BugReportPrefill | null }) {
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [priority, setPriority] = useState<BugPriority>("medium");
  const [severity, setSeverity] = useState<BugSeverity>("major");
  const [assigneeId, setAssigneeId] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchMembers = useCallback(() => api.members.list(slug), [slug]);
  const members = useLoad(fetchMembers);

  function fail(fields: Record<string, string>, message: string | null) {
    setFieldErrors(fields);
    setFormError(message);
    focusField(formRef.current, fields);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    // Baris link yang sama sekali kosong diabaikan; indeksnya dicatat untuk memetakan error ke baris formulir.
    const rowIndexes = links.flatMap((link, index) => (link.url.trim() === "" && link.title.trim() === "" ? [] : [index]));
    const body = {
      title,
      description,
      priority,
      severity,
      labels,
      links: rowIndexes.map((index) => ({ url: links[index]!.url.trim(), title: links[index]!.title })),
      ...(assigneeId !== "" ? { assigneeId } : {}),
      ...(prefill ? { testCaseId: prefill.testCaseId, ...(prefill.runId ? { runId: prefill.runId } : {}) } : {}),
    };
    const parsed = createBugBody.safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.map(String).join(".") || "form"] ??= issue.message;
      return fail(remapLinkKeys(fields, rowIndexes), null);
    }

    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      const bug = await api.bugs.create(slug, parsed.data);
      navigate(`/p/${encodeURIComponent(slug)}/bugs/${bug.number}`);
    } catch (err) {
      const serverKeys = err instanceof ApiError ? Object.keys(err.fields ?? {}) : [];
      const known = serverKeys.filter((key) => (SCALAR_FIELDS as readonly string[]).includes(key) || /^(labels|links)(\.|$)/.test(key));
      const mapped = serverErrorToForm(err, known);
      fail(remapLinkKeys(mapped.fields, rowIndexes), mapped.message);
      setSubmitting(false);
    }
  }

  const memberOptions = members.state === "ready" ? members.data : [];
  const linkErrors = Object.fromEntries(Object.entries(fieldErrors).filter(([key]) => key.startsWith("links")));

  return (
    <section aria-labelledby="bug-new-title" className="grid min-w-0 grid-cols-1 gap-6">
      <div className="grid min-w-0 gap-3">
        <Link to={`/p/${encodeURIComponent(slug)}/bugs`} className={BACK_LINK_CLASS} data-testid="bug-new-back">
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          Daftar bug
        </Link>
        <h1 id="bug-new-title" className="text-2xl font-semibold tracking-tight">
          Buat bug
        </h1>
        {prefill ? (
          <p className="m-0 text-sm text-muted-foreground [overflow-wrap:anywhere]" data-testid="bug-new-origin">
            Dilaporkan dari test <span className="font-medium text-foreground">{prefill.testName}</span> ({prefill.suite}
            ). Bug ini akan tertaut ke test{prefill.runId ? " dan run tersebut" : ""}.
          </p>
        ) : null}
      </div>

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="grid min-w-0 gap-5" data-testid="bug-form">
        <FormError message={formError} />
        <FormField name="title" label="Judul" value={title} onChange={setTitle} error={fieldErrors.title} testIdPrefix="bug" />
        <MarkdownEditor
          name="description"
          label="Deskripsi"
          value={description}
          onChange={setDescription}
          error={fieldErrors.description}
          hint="Mendukung Markdown. Boleh dikosongkan."
          testId="bug-description"
        />
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
          <SelectField name="priority" label="Prioritas" testId="bug-priority" value={priority} onChange={(v) => setPriority(v as BugPriority)}>
            {BUG_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {BUG_PRIORITY_LABEL[value]}
              </option>
            ))}
          </SelectField>
          <SelectField name="severity" label="Severity" testId="bug-severity" value={severity} onChange={(v) => setSeverity(v as BugSeverity)}>
            {BUG_SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {BUG_SEVERITY_LABEL[value]}
              </option>
            ))}
          </SelectField>
          <SelectField name="assigneeId" label="Assignee" testId="bug-assignee" value={assigneeId} onChange={setAssigneeId} error={fieldErrors.assigneeId}>
            <option value="">Belum di-assign</option>
            {memberOptions.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </SelectField>
        </div>
        <BugLabelsInput value={labels} onChange={setLabels} error={fieldErrors.labels} />
        <BugLinksInput value={links} onChange={setLinks} errors={linkErrors} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={submitting} data-testid="bug-submit">
            {submitting ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
            Simpan bug
          </Button>
          <Button asChild variant="outline">
            <Link to={`/p/${encodeURIComponent(slug)}/bugs`}>Batal</Link>
          </Button>
        </div>
      </form>
    </section>
  );
}

function SelectField({
  name,
  label,
  testId,
  value,
  onChange,
  error,
  children,
}: {
  name: string;
  label: string;
  testId: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1.5 [&>span]:w-full">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        name={name}
        value={value}
        data-testid={testId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="w-full"
      >
        {children}
      </NativeSelect>
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
