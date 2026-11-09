import {
  createManualRunBody,
  MAX_RUN_CASES,
  runVersion,
  type ManualCaseListItemDto,
  type ProjectDto,
  type SuiteDto,
} from "@testpulse/shared";
import { ArrowLeft, ListChecks, Loader2, LockKeyhole, Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { FormError } from "@/components/FormError";
import { FormField } from "@/components/FormField";
import { INLINE_LINK_CLASS } from "@/components/inlineLink";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { focusField, serverErrorToForm, useDocumentTitle } from "@/lib/forms";
import { caseCode, countSelection } from "@/lib/manual";
import { loginPathFor } from "@/lib/navigation";
import { useLoad } from "@/lib/useLoad";
import { preloadPages } from "./lazyPages";
import { BACK_LINK_CLASS, ProjectFrame } from "./ProjectFrame";

const FORM_FIELDS = ["name", "appVersion", "selection", "suiteIds", "caseNumbers"] as const;
const VERSION_LIST_ID = "run-version-options";
const SELECTION_MESSAGE = `Pilih 1–${MAX_RUN_CASES} case aktif`;

/** `/p/:slug/manual-runs/new`: nama, versi, pilihan suite, case satuan, dan ringkasan jumlah case yang akan disalin. */
export function ManualRunNewPage() {
  const { slug = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title="Buat run manual" tab="manual">
      {(project) => <FormGate project={project} />}
    </ProjectFrame>
  );
}

function FormGate({ project }: { project: ProjectDto }) {
  const { pathname, search } = useLocation();
  const canWrite = project.myRole === "tester" || project.myRole === "admin";
  if (!canWrite) {
    return (
      <EmptyState icon={LockKeyhole} title="Tidak bisa membuat run manual" headingLevel="h1" data-testid="manual-run-new-forbidden">
        <p>
          {project.myRole === "viewer"
            ? "Peran viewer hanya bisa melihat run manual. Minta admin project mengubah peranmu menjadi tester untuk membuat run."
            : "Hanya tester dan admin project ini yang bisa membuat run manual. Masuk dengan akun anggota untuk melanjutkan."}
        </p>
        {project.myRole === null ? (
          <Link to={loginPathFor(`${pathname}${search}`)} className={INLINE_LINK_CLASS}>
            Masuk
          </Link>
        ) : null}
      </EmptyState>
    );
  }
  return <FormLoader key={project.slug} slug={project.slug} />;
}

interface FormSource {
  suites: SuiteDto[];
  /** Saran versi dari halaman Versi (branch default); kosong bila gagal dimuat. */
  versions: string[];
}

/**
 * Memuat suite dan saran versi lebih dulu, baru memasang formulir. Saran versi bersifat tambahan: kegagalannya tidak
 * menghalangi pembuatan run.
 */
function FormLoader({ slug }: { slug: string }) {
  useEffect(() => preloadPages("manualRun"), []);
  const fetchSource = useCallback(async (): Promise<FormSource> => {
    const [suites, versions] = await Promise.all([
      api.manual.suites.list(slug),
      api.results.versions(slug).then(
        (rows) => [...new Set(rows.map((row) => row.version))].filter((v) => runVersion.safeParse(v).success),
        () => [],
      ),
    ]);
    return { suites, versions };
  }, [slug]);
  const load = useLoad(fetchSource);

  if (load.state === "loading") return <Loading label="Menyiapkan formulir…" />;
  if (load.state === "error") {
    return <LoadError error={load.error} fallback="Gagal memuat formulir run. Coba lagi." onRetry={load.reload} />;
  }
  const { suites, versions } = load.data;
  if (suites.length === 0) {
    return (
      <EmptyState icon={ListChecks} title="Buat suite dan case lebih dulu" headingLevel="h1" data-testid="run-no-suites">
        <p>Run manual dibuat dari suite atau case yang sudah ada. Tambahkan suite dan test case di halaman test case, lalu kembali ke sini.</p>
        <Link to={`/p/${encodeURIComponent(slug)}/cases`} className={BACK_LINK_CLASS}>
          Ke daftar case
        </Link>
      </EmptyState>
    );
  }
  return <RunForm slug={slug} suites={suites} versions={versions} />;
}

/** Case satuan yang dipilih; `suiteId` dipakai agar case di suite yang ikut terpilih tidak dihitung dua kali. */
interface PickedCase {
  number: number;
  title: string;
  suiteId: string;
  suiteName: string;
}

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: ManualCaseListItemDto[]; nextCursor: string | null; loadingMore: boolean };

function RunForm({ slug, suites, versions }: { slug: string; suites: SuiteDto[]; versions: string[] }) {
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<PickedCase[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const versionId = useId();
  useDocumentTitle("Buat run manual");

  const count = useMemo(() => countSelection(suites, selected, picked), [suites, selected, picked]);
  const outOfRange = count < 1 || count > MAX_RUN_CASES;
  const selectionError = fieldErrors.selection ?? fieldErrors.suiteIds ?? fieldErrors.caseNumbers;

  function toggleSuite(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function fail(fields: Record<string, string>, message: string | null) {
    setFieldErrors(fields);
    setFormError(message);
    focusField(formRef.current, fields);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const trimmedVersion = appVersion.trim();
    const parsed = createManualRunBody.safeParse({
      name,
      ...(trimmedVersion === "" ? {} : { appVersion: trimmedVersion }),
      suiteIds: [...selected],
      caseNumbers: picked.map((item) => item.number),
    });
    if (!parsed.success || outOfRange) {
      const fields: Record<string, string> = {};
      if (!parsed.success) {
        for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
      }
      if (outOfRange) fields.selection ??= SELECTION_MESSAGE;
      return fail(fields, null);
    }

    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      const run = await api.manual.runs.create(slug, parsed.data);
      navigate(`/p/${encodeURIComponent(slug)}/manual-runs/${run.number}`);
    } catch (err) {
      setSubmitting(false);
      const mapped = serverErrorToForm(err, FORM_FIELDS);
      fail(mapped.fields, mapped.message);
    }
  }

  return (
    <section aria-labelledby="manual-run-new-title" className="grid min-w-0 grid-cols-1 gap-6">
      <div className="grid min-w-0 gap-3">
        <Link to={`/p/${encodeURIComponent(slug)}/manual-runs`} className={BACK_LINK_CLASS} data-testid="manual-run-new-back">
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          Run manual
        </Link>
        <h1 id="manual-run-new-title" className="text-2xl font-semibold tracking-tight">
          Buat run manual
        </h1>
      </div>

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="grid min-w-0 gap-6" data-testid="manual-run-form">
        <FormError message={formError} />
        <div className="grid min-w-0 gap-5 sm:max-w-xl">
          <FormField name="name" label="Nama run" value={name} onChange={setName} error={fieldErrors.name} testIdPrefix="run" />
          <div className="grid gap-1.5">
            <Label htmlFor={versionId}>Versi aplikasi (opsional)</Label>
            <Input
              id={versionId}
              name="appVersion"
              list={VERSION_LIST_ID}
              value={appVersion}
              autoComplete="off"
              aria-invalid={fieldErrors.appVersion ? true : undefined}
              aria-describedby={fieldErrors.appVersion ? `${versionId}-error` : `${versionId}-hint`}
              data-testid="run-version"
              onChange={(e) => setAppVersion(e.target.value)}
            />
            <datalist id={VERSION_LIST_ID}>
              {versions.map((version) => (
                <option key={version} value={version} />
              ))}
            </datalist>
            <p id={`${versionId}-hint`} className="text-sm text-muted-foreground">
              Samakan dengan versi run CI agar hasilnya muncul sebaris di halaman Versi.
            </p>
            {fieldErrors.appVersion ? (
              <p id={`${versionId}-error`} className="text-sm font-medium text-destructive" data-testid="field-error-appVersion">
                {fieldErrors.appVersion}
              </p>
            ) : null}
          </div>
        </div>

        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0">
          <legend className="mb-1 p-0 text-sm font-semibold">Suite</legend>
          <p className="m-0 text-sm text-muted-foreground">Semua case aktif di suite yang dicentang ikut disalin ke run.</p>
          <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2">
            {suites.map((suite) => (
              <li key={suite.id} className="min-w-0">
                <label className="flex min-h-9 min-w-0 items-center gap-2 rounded-md px-1 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    checked={selected.has(suite.id)}
                    disabled={suite.activeCount === 0}
                    data-testid={`run-suite-${suite.id}`}
                    onChange={(e) => toggleSuite(suite.id, e.target.checked)}
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="font-medium">{suite.name}</span>{" "}
                    <span className="text-muted-foreground">({suite.activeCount} case aktif)</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <CasePicker slug={slug} selected={selected} picked={picked} onChange={setPicked} />

        <div className="grid min-w-0 gap-3 border-t pt-5">
          <p role="status" className="m-0 text-sm" data-testid="run-selection-summary">
            <strong>{count} case</strong> akan disalin ke run ini.
            {count > MAX_RUN_CASES ? ` Maksimal ${MAX_RUN_CASES} case; kurangi pilihanmu.` : ""}
            {count === 0 ? " Centang suite atau tambahkan case satuan." : ""}
          </p>
          {selectionError ? (
            <p className="m-0 text-sm font-medium text-destructive" data-testid="field-error-selection">
              {selectionError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={submitting || outOfRange} data-testid="run-submit">
              {submitting ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              Buat run
            </Button>
            <Button asChild variant="outline">
              <Link to={`/p/${encodeURIComponent(slug)}/manual-runs`}>Batal</Link>
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}

/**
 * Pencarian case aktif untuk menambah case satuan, dan daftar case terpilih yang bisa dilepas. Pencarian bukan
 * `<form>` sendiri karena berada di dalam formulir run (form tidak boleh bersarang): Enter di kolom cari menjalankan
 * pencarian, bukan membuat run.
 */
function CasePicker({
  slug,
  selected,
  picked,
  onChange,
}: {
  slug: string;
  selected: ReadonlySet<string>;
  picked: PickedCase[];
  onChange: (picked: PickedCase[]) => void;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  // Hanya respons pencarian terbaru yang dipakai (dua pencarian beruntun bisa selesai tidak berurutan).
  const latest = useRef(0);
  const lastQuery = useRef("");
  useEffect(
    () => () => {
      latest.current += 1;
    },
    [],
  );

  async function run() {
    const request = ++latest.current;
    const q = query.trim();
    lastQuery.current = q;
    setSearch({ status: "loading" });
    try {
      const page = await api.manual.cases.list(slug, { ...(q === "" ? {} : { q }) });
      if (request === latest.current) {
        setSearch({ status: "ready", items: page.items, nextCursor: page.nextCursor, loadingMore: false });
      }
    } catch (err) {
      if (request === latest.current) setSearch({ status: "error", message: errorText(err) });
    }
  }

  async function loadMore() {
    if (search.status !== "ready" || search.nextCursor === null || search.loadingMore) return;
    const request = ++latest.current;
    const { items, nextCursor } = search;
    const q = lastQuery.current;
    setSearch({ ...search, loadingMore: true });
    try {
      const page = await api.manual.cases.list(slug, { ...(q === "" ? {} : { q }), cursor: nextCursor });
      if (request === latest.current) {
        setSearch({ status: "ready", items: [...items, ...page.items], nextCursor: page.nextCursor, loadingMore: false });
      }
    } catch (err) {
      if (request === latest.current) setSearch({ status: "error", message: errorText(err) });
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void run();
  }

  function pick(item: ManualCaseListItemDto) {
    if (picked.some((p) => p.number === item.number)) return;
    onChange([...picked, { number: item.number, title: item.title, suiteId: item.suite.id, suiteName: item.suite.name }]);
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 gap-1">
        <h2 className="m-0 text-sm font-semibold">Case satuan</h2>
        <p className="m-0 text-sm text-muted-foreground">Cari judul case aktif untuk menambahkannya di luar suite yang dicentang.</p>
      </div>
      <div role="search" className="flex min-w-0 flex-wrap items-end gap-2">
        <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-md">
          <Label htmlFor={inputId}>Cari case</Label>
          <Input
            id={inputId}
            type="search"
            value={query}
            maxLength={100}
            autoComplete="off"
            data-testid="run-case-search"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <Button type="button" variant="outline" onClick={() => void run()} data-testid="run-case-search-submit">
          <Search aria-hidden="true" />
          Cari
        </Button>
      </div>

      <div role="status" className="text-sm text-muted-foreground" data-testid="run-case-search-status">
        {search.status === "loading" ? "Mencari…" : null}
        {search.status === "error" ? <span className="font-medium text-destructive">{search.message}</span> : null}
        {search.status === "ready"
          ? search.items.length === 0
            ? "Tidak ada case aktif yang cocok."
            : `Menampilkan ${search.items.length} case${search.nextCursor === null ? " (semua)" : ""}.`
          : null}
      </div>

      {search.status === "ready" && search.items.length > 0 ? (
        <>
          <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0" aria-label="Hasil pencarian case">
            {search.items.map((item) => {
              const added = picked.some((p) => p.number === item.number);
              return (
                <li key={item.number} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5">
                  <span className="grid min-w-0 gap-0.5">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="font-mono text-sm text-muted-foreground">{caseCode(item.number)}</span>
                      <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{item.title}</span>
                    </span>
                    <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      Suite {item.suite.name}
                      {selected.has(item.suite.id) ? " (sudah dicentang)" : ""}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={added}
                    aria-label={`${added ? "Sudah ditambahkan" : "Tambah"} ${caseCode(item.number)} ${item.title}`}
                    data-testid={`run-case-option-${item.number}`}
                    onClick={() => pick(item)}
                  >
                    {added ? "Ditambahkan" : "Tambah"}
                  </Button>
                </li>
              );
            })}
          </ul>
          {search.nextCursor !== null ? (
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadMore()} disabled={search.loadingMore} data-testid="run-case-search-more">
                {search.loadingMore ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
                Muat lagi
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {picked.length > 0 ? (
        <div className="grid min-w-0 gap-2">
          <h3 className="m-0 text-sm font-semibold">Case satuan terpilih ({picked.length})</h3>
          <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0" data-testid="run-picked-list">
            {picked.map((item) => (
              <li
                key={item.number}
                data-testid={`run-picked-${item.number}`}
                className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5"
              >
                <span className="grid min-w-0 gap-0.5">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="font-mono text-sm text-muted-foreground">{caseCode(item.number)}</span>
                    <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{item.title}</span>
                  </span>
                  <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    Suite {item.suiteName}
                    {selected.has(item.suiteId) ? " (sudah dicentang, tidak dihitung dua kali)" : ""}
                  </span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Lepas ${caseCode(item.number)} ${item.title}`}
                  data-testid={`run-unpick-${item.number}`}
                  onClick={() => onChange(picked.filter((p) => p.number !== item.number))}
                >
                  Lepas
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message !== "" ? err.message : "Gagal mencari case. Coba lagi.";
}
