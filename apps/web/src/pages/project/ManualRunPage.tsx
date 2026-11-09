import {
  MANUAL_RESULT_STATUSES,
  updateManualRunBody,
  type ManualRunDto,
  type MemberDto,
  type RunCaseListItemDto,
} from "@testpulse/shared";
import { ArrowLeft, CheckCheck, ClipboardList, ListChecks, Loader2, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BugBadge } from "@/components/BugBadge";
import { EmptyState } from "@/components/EmptyState";
import { FilterSelect } from "@/components/FilterSelect";
import { FormError } from "@/components/FormError";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { ManualRunStatus, ManualStatus } from "@/components/ManualStatus";
import { ManualSubTabs } from "@/components/ManualSubTabs";
import { RunProgress } from "@/components/RunProgress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { errorMessage, useDocumentTitle, validate } from "@/lib/forms";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import {
  CASE_PRIORITY_LABEL,
  caseCode,
  groupBySuite,
  MANUAL_STATUS_LABEL,
  parseRunCaseFilters,
  parseRunNumber,
  RUN_CASE_FILTER_KEYS,
  runCode,
  type RunCaseFilters,
  type RunLocationState,
} from "@/lib/manual";
import { useCursorList } from "@/lib/useCursorList";
import { useLoad } from "@/lib/useLoad";
import { preloadPages } from "./lazyPages";
import { BACK_LINK_CLASS, ProjectFrame } from "./ProjectFrame";

/** `/p/:slug/manual-runs/:number`: header run, progres, aksi (selesaikan/buka ulang/ganti nama/hapus), dan case per suite. */
export function ManualRunPage() {
  const { slug = "", number } = useParams();
  const runNumber = number === undefined ? null : parseRunNumber(number);
  return (
    <ProjectFrame slug={slug} title={runNumber === null ? "Run manual" : runCode(runNumber)} tab="manual">
      {(project) => (
        <RunLoader
          key={`${project.slug}:${runNumber}`}
          slug={project.slug}
          number={runNumber}
          isMember={project.myRole !== null}
          canWrite={project.myRole === "tester" || project.myRole === "admin"}
          canDelete={project.myRole === "admin"}
        />
      )}
    </ProjectFrame>
  );
}

interface Access {
  slug: string;
  isMember: boolean;
  canWrite: boolean;
  canDelete: boolean;
}

function RunLoader({ number, ...access }: Access & { number: number | null }) {
  const { slug } = access;
  const fetchRun = useCallback(async (): Promise<ManualRunDto> => {
    if (number === null) throw new ApiError(404, "MANUAL_RUN_NOT_FOUND", "Run tidak ditemukan");
    return api.manual.runs.get(slug, number);
  }, [slug, number]);
  const load = useLoad(fetchRun);

  if (load.state === "loading") return <Loading label="Memuat run…" />;
  if (load.state === "error") {
    if (load.error instanceof ApiError && load.error.code === "MANUAL_RUN_NOT_FOUND") {
      return (
        <EmptyState icon={ClipboardList} title="Run tidak ditemukan" headingLevel="h1" data-testid="manual-run-not-found">
          <p>Run ini tidak ada di project ini, atau sudah dihapus.</p>
          <Link to={`/p/${encodeURIComponent(slug)}/manual-runs`} className={BACK_LINK_CLASS}>
            Ke daftar run
          </Link>
        </EmptyState>
      );
    }
    return <LoadError error={load.error} fallback="Gagal memuat run. Coba lagi." onRetry={load.reload} />;
  }
  return <RunView {...access} initial={load.data} />;
}

type SaveResult = { ok: true } | { ok: false; message?: string; fields?: Record<string, string>; conflict?: boolean };
/** Run diubah orang lain (`MANUAL_RUN_CONFLICT`) atau diselesaikan orang lain selagi halaman terbuka (`RUN_COMPLETED`). */
type Clash = "changed" | "completed";

function RunView({ slug, isMember, canWrite, canDelete, initial }: Access & { initial: ManualRunDto }) {
  const navigate = useNavigate();
  const location = useLocation();
  // Datang dari "Simpan & lanjut" pada case terakhir; dibaca sekali saat halaman dipasang.
  const [allExecuted] = useState(() => Boolean((location.state as RunLocationState | null)?.allExecuted));
  const [run, setRun] = useState(initial);
  const [clash, setClash] = useState<Clash | null>(null);
  const [reloading, setReloading] = useState(false);
  // Berapa kali run dimuat ulang; daftar case dipasang ulang agar hitungannya ikut segar.
  const [reloads, setReloads] = useState(0);
  const [pending, setPending] = useState<"complete" | "reopen" | "rename" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  const completed = run.status === "completed";
  // Selesai di sini, atau diketahui selesai di tempat lain (RUN_COMPLETED): hanya-baca sampai dimuat ulang.
  const locked = completed || clash === "completed";
  const code = runCode(run.number);
  const base = `/p/${encodeURIComponent(slug)}`;
  useDocumentTitle(`${code} · ${run.name}`);
  useEffect(() => preloadPages("manualExecute"), []);

  useEffect(() => {
    if (reloads > 0 && focusHeading.current) {
      focusHeading.current = false;
      headingRef.current?.focus();
    }
  }, [reloads]);

  async function patch(body: { name?: string; status?: "open" | "completed" }, kind: "complete" | "reopen" | "rename"): Promise<SaveResult> {
    setPending(kind);
    setActionError(null);
    try {
      const updated = await api.manual.runs.update(slug, run.number, { ...body, version: run.version });
      setRun(updated);
      setClash(null);
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError && err.code === "MANUAL_RUN_CONFLICT") {
        setClash("changed");
        return { ok: false, conflict: true };
      }
      if (err instanceof ApiError && err.code === "RUN_COMPLETED") {
        setClash("completed");
        return { ok: false, conflict: true };
      }
      const fields = err instanceof ApiError ? err.fields : undefined;
      const message = errorMessage(err, "Gagal menyimpan perubahan. Coba lagi.");
      if (kind !== "rename") setActionError(message);
      return { ok: false, message, ...(fields ? { fields } : {}) };
    } finally {
      setPending(null);
    }
  }

  async function reload() {
    setReloading(true);
    try {
      const fresh = await api.manual.runs.get(slug, run.number);
      setRun(fresh);
      setClash(null);
      setActionError(null);
      focusHeading.current = true;
      setReloads((n) => n + 1);
    } catch (err) {
      if (err instanceof ApiError && err.code === "MANUAL_RUN_NOT_FOUND") {
        navigate(`${base}/manual-runs`);
        return;
      }
      setActionError(errorMessage(err, "Gagal memuat ulang run. Coba lagi."));
    } finally {
      setReloading(false);
    }
  }

  /** Membuka case `untested` pertama (menurut urutan run), bukan yang pertama pada daftar yang sedang disaring. */
  async function start() {
    setStarting(true);
    setActionError(null);
    try {
      const page = await api.manual.runCases.list(slug, run.number, { status: "untested" });
      const first = page.items[0];
      if (first) navigate(`${base}/manual-runs/${run.number}/cases/${encodeURIComponent(first.id)}`);
      else {
        setActionError("Semua case sudah dieksekusi. Muat ulang halaman untuk melihat hitungan terbaru.");
        setStarting(false);
      }
    } catch (err) {
      setActionError(errorMessage(err, "Gagal membuka case pertama. Coba lagi."));
      setStarting(false);
    }
  }

  async function remove() {
    await api.manual.runs.remove(slug, run.number);
    navigate(`${base}/manual-runs`);
  }

  return (
    <section aria-labelledby="run-title" className="grid min-w-0 grid-cols-1 gap-6">
      <div className="grid min-w-0 gap-3">
        <Link to={`${base}/manual-runs`} className={BACK_LINK_CLASS} data-testid="manual-run-back">
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          Run manual
        </Link>
      </div>

      <ManualSubTabs slug={slug} active="runs" />

      <div className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 text-card-foreground" data-testid="run-header">
        <div className="grid min-w-0 gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-sm text-muted-foreground" data-testid="run-code">
              {code}
            </span>
            <ManualRunStatus status={run.status} className="text-sm" data-testid="run-status" />
          </div>
          <RunTitle
            name={run.name}
            version={run.version}
            canEdit={canWrite && !locked}
            headingRef={headingRef}
            onSave={(name) => patch({ name }, "rename")}
          />
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {run.appVersion ? (
              <span className="min-w-0 [overflow-wrap:anywhere]">
                Versi <span className="font-mono">{run.appVersion}</span>
              </span>
            ) : null}
            <span className="min-w-0 [overflow-wrap:anywhere]">Dibuat oleh {run.createdBy.name}</span>
            <time dateTime={run.createdAt}>{formatDateTime(run.createdAt)}</time>
          </p>
        </div>

        <RunProgress counts={run.counts} total={run.total} />

        {allExecuted && run.counts.untested === 0 ? (
          <p role="status" className="m-0 rounded-md border bg-muted/50 px-3 py-2 text-sm font-medium" data-testid="run-all-executed">
            Semua case sudah dieksekusi.
          </p>
        ) : null}

        {completed ? (
          <p className="m-0 rounded-md border bg-muted/50 px-3 py-2 text-sm" data-testid="run-completed-note">
            Run ini sudah diselesaikan
            {run.completedBy ? ` oleh ${run.completedBy.name}` : ""}
            {run.completedAt ? ` pada ${formatDateTime(run.completedAt)}` : ""}. Hasilnya hanya bisa dibaca
            {canWrite ? " sampai run dibuka ulang." : "."}
          </p>
        ) : null}

        {clash ? (
          <div
            role="alert"
            data-testid="run-conflict"
            className="grid justify-items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <div className="grid gap-1">
              <p className="m-0 font-semibold">
                {clash === "completed" ? "Run ini sudah diselesaikan orang lain" : "Run ini baru saja diubah orang lain"}
              </p>
              <p className="m-0">Muat ulang untuk melihat keadaan terbaru, lalu ulangi perubahanmu bila masih perlu.</p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={reloading} onClick={() => void reload()} data-testid="run-conflict-reload">
              {reloading ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              Muat ulang run
            </Button>
          </div>
        ) : null}

        {canWrite && clash !== "completed" ? (
          <div className="flex flex-wrap items-start gap-2">
            {!completed && run.counts.untested > 0 ? (
              <Button type="button" onClick={() => void start()} disabled={starting} data-testid="run-start">
                {starting ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
                Mulai eksekusi
              </Button>
            ) : null}
            {completed ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void patch({ status: "open" }, "reopen")}
                disabled={pending !== null}
                data-testid="run-reopen"
              >
                {pending === "reopen" ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
                Buka ulang
              </Button>
            ) : (
              <CompleteControl
                untested={run.counts.untested}
                pending={pending === "complete"}
                disabled={pending !== null}
                onComplete={() => patch({ status: "completed" }, "complete")}
              />
            )}
          </div>
        ) : null}
        {actionError ? (
          <div role="alert" className="text-sm font-medium text-destructive" data-testid="run-action-error">
            {actionError}
          </div>
        ) : null}
        {canDelete ? <RunDeleteControl code={code} onDelete={remove} /> : null}
      </div>

      <RunCases key={reloads} slug={slug} number={run.number} isMember={isMember} />
    </section>
  );
}

/** Judul run (h1) dengan ganti nama inline untuk tester/admin selama run terbuka: Enter menyimpan, Escape membatalkan. */
function RunTitle({
  name,
  version,
  canEdit,
  headingRef,
  onSave,
}: {
  name: string;
  version: number;
  canEdit: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onSave: (name: string) => Promise<SaveResult>;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const editButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const wasEditing = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Run menjadi hanya-baca (diselesaikan di sini atau di tempat lain) selagi formulir terbuka: keluar dari mode edit.
  // Draf dibuang; saat run dibuka ulang pengguna memulai dari nama terbaru.
  if (editing && !canEdit) {
    setEditing(false);
    setError(null);
  }

  // Fokus mengikuti mode: ke kolom saat edit dimulai, kembali ke tombol Ubah nama saat selesai atau dibatalkan.
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (wasEditing.current) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function open() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (pending) return;
    const validated = validate(updateManualRunBody, { version, name: draft });
    if (!validated.ok) {
      setError(validated.fields.name ?? "Nama tidak valid");
      input.current?.focus();
      return;
    }
    const next = validated.data.name ?? name;
    if (next === name) return cancel();
    setPending(true);
    const result = await onSave(next);
    setPending(false);
    if (result.ok) return setEditing(false);
    // Konflik ditangani banner di induk; draf tetap ada sampai run dimuat ulang.
    if (!result.conflict) {
      setError(result.fields?.name ?? result.message ?? "Gagal menyimpan nama");
      input.current?.focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2">
        <h1
          id="run-title"
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 flex-1 basis-60 text-2xl font-semibold tracking-tight outline-hidden [overflow-wrap:anywhere]"
          data-testid="run-title"
        >
          {name}
        </h1>
        {canEdit ? (
          <Button ref={editButton} type="button" variant="outline" size="sm" aria-label="Ubah nama run" data-testid="run-rename" onClick={open}>
            <Pencil aria-hidden="true" />
            Ubah nama
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid min-w-0 gap-3" aria-label="Ganti nama run">
      <h1 id="run-title" className="sr-only">
        {name}
      </h1>
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={inputId}>Nama run</Label>
        <Input
          id={inputId}
          ref={input}
          value={draft}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          data-testid="run-name-input"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {error ? (
          <p id={errorId} className="text-sm font-medium text-destructive" data-testid="field-error-name">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending} data-testid="run-name-save">
          {pending ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
          Simpan
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={cancel} disabled={pending} data-testid="run-name-cancel">
          Batal
        </Button>
      </div>
    </form>
  );
}

/**
 * "Selesaikan run" dengan konfirmasi inline bila masih ada case belum dites (spec §4.4, §8.7). Tanpa case belum dites
 * run langsung diselesaikan. Fokus mengikuti langkah: ke "Batal" (aksi aman) saat konfirmasi muncul, kembali ke tombol saat ditutup.
 */
function CompleteControl({
  untested,
  pending,
  disabled,
  onComplete,
}: {
  untested: number;
  pending: boolean;
  disabled: boolean;
  onComplete: () => Promise<SaveResult>;
}) {
  const questionId = useId();
  const [confirming, setConfirming] = useState(false);
  const completeRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) completeRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  async function complete() {
    await onComplete();
    setConfirming(false);
  }

  if (confirming) {
    return (
      <div role="group" aria-labelledby={questionId} className="grid min-w-0 flex-1 gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
        <p id={questionId} className="m-0 text-sm font-medium" data-testid="run-complete-question">
          Masih ada {untested} case belum dites. Selesaikan tetap?
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => void complete()} disabled={disabled} data-testid="run-complete-confirm">
            {pending ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <CheckCheck aria-hidden="true" />}
            Ya, selesaikan
          </Button>
          <Button ref={cancelRef} type="button" size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={disabled} data-testid="run-complete-cancel">
            Batal
          </Button>
        </div>
      </div>
    );
  }
  return (
    <Button
      ref={completeRef}
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={() => (untested > 0 ? setConfirming(true) : void complete())}
      data-testid="run-complete"
    >
      {pending ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <CheckCheck aria-hidden="true" />}
      Selesaikan run
    </Button>
  );
}

/** Hapus run (admin) dengan konfirmasi inline; sengaja bukan dialog (komponen dialog tidak diizinkan). */
function RunDeleteControl({ code, onDelete }: { code: string; onDelete: () => Promise<void> }) {
  const questionId = useId();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) deleteRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      setError(errorMessage(err, "Gagal menghapus run. Coba lagi."));
      setPending(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-3 border-t pt-4">
      {confirming ? (
        <div role="group" aria-labelledby={questionId} className="grid gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <p id={questionId} className="m-0 text-sm font-medium">
            Hapus {code} beserta seluruh hasil eksekusinya? Tindakan ini tidak dapat dibatalkan. Test case asalnya tidak ikut terhapus.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" size="sm" onClick={() => void remove()} disabled={pending} data-testid="run-delete-confirm">
              {pending ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              Ya, hapus run
            </Button>
            <Button ref={cancelRef} type="button" variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={pending} data-testid="run-delete-cancel">
              Batal
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button ref={deleteRef} type="button" variant="outline" size="sm" onClick={() => setConfirming(true)} data-testid="run-delete">
            <Trash2 aria-hidden="true" />
            Hapus run
          </Button>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}

// --- Daftar case --------------------------------------------------------------------------------------------------

/** Filter, daftar case per suite, dan "Muat lagi" untuk satu run. Filter tersimpan di URL. */
function RunCases({ slug, number, isMember }: { slug: string; number: number; isMember: boolean }) {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseRunCaseFilters(params), [params]);
  // Berdasarkan URL (bukan filter yang lolos validasi) agar "Atur ulang filter" juga membersihkan parameter yang tidak valid.
  const hasFilters = RUN_CASE_FILTER_KEYS.some((key) => params.has(key));

  /** Menulis satu filter ke URL (kosong menghapusnya); dasarnya URL saat ini, bukan `params` render terakhir (lihat BugsPage). */
  function setFilter(key: (typeof RUN_CASE_FILTER_KEYS)[number], value: string) {
    const next = new URLSearchParams(window.location.search);
    if (value === "") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <h2 className="m-0 text-lg font-semibold tracking-tight">Case dalam run</h2>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
        <FilterSelect
          label="Status"
          testId="run-filter-status"
          allLabel="Semua status"
          value={filters.status ?? ""}
          options={MANUAL_RESULT_STATUSES.map((status): [string, string] => [status, MANUAL_STATUS_LABEL[status]])}
          onChange={(value) => setFilter("status", value)}
        />
        <AssigneeFilter slug={slug} isMember={isMember} value={filters.assignee ?? ""} onChange={(value) => setFilter("assignee", value)} />
        <SuiteFilter slug={slug} number={number} value={filters.suite ?? ""} onChange={(value) => setFilter("suite", value)} />
      </div>
      <RunCaseList
        key={params.toString()}
        slug={slug}
        number={number}
        filters={filters}
        resetFilters={hasFilters ? () => setParams({}, { replace: true }) : undefined}
      />
    </div>
  );
}

/**
 * Filter assignee. Daftar anggota hanya terbuka untuk anggota project (tidak pernah publik), jadi pengunjung lain
 * hanya mendapat "Belum di-assign"; "Case saya" juga hanya bermakna bagi anggota.
 */
function AssigneeFilter({
  slug,
  isMember,
  value,
  onChange,
}: {
  slug: string;
  isMember: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const fetchMembers = useCallback(
    (): Promise<MemberDto[]> => (isMember ? api.members.list(slug) : Promise.resolve([])),
    [slug, isMember],
  );
  const members = useLoad(fetchMembers);
  // Pemuatan anggota bersifat tambahan: bila gagal, "Case saya"/"Belum di-assign" tetap bisa dipakai.
  const list = members.state === "ready" ? members.data : [];
  const options: [string, ReactNode][] = [
    ...(isMember ? ([["me", "Case saya"]] as [string, ReactNode][]) : []),
    ["none", "Belum di-assign"],
    ...list.map((member): [string, ReactNode] => [member.userId, member.name]),
  ];
  // Assignee dari URL yang tidak (atau belum) ada di daftar tetap ditampilkan agar pilihan tidak diam-diam berubah.
  if (value !== "" && !options.some(([optionValue]) => optionValue === value)) options.push([value, "Anggota lain"]);
  return (
    <FilterSelect
      label="Assignee"
      testId="run-filter-assignee"
      allLabel="Semua assignee"
      value={value}
      options={options}
      onChange={onChange}
    />
  );
}

/** Halaman run case tanpa filter yang dibaca untuk mengumpulkan nama suite snapshot (maks 500 case = 5 halaman). */
const SUITE_NAME_PAGES = 5;

/**
 * Filter suite. Nama suite yang ditawarkan adalah nama pada snapshot (bisa berbeda dari nama suite sekarang), jadi
 * diambil dari case run itu sendiri, bukan dari daftar suite project.
 */
function SuiteFilter({ slug, number, value, onChange }: { slug: string; number: number; value: string; onChange: (value: string) => void }) {
  const fetchNames = useCallback(async (): Promise<string[]> => {
    const names: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < SUITE_NAME_PAGES; page += 1) {
      const result = await api.manual.runCases.list(slug, number, { cursor });
      for (const item of result.items) if (!names.includes(item.suiteName)) names.push(item.suiteName);
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    return names;
  }, [slug, number]);
  const loaded = useLoad(fetchNames);
  const names = loaded.state === "ready" ? loaded.data : [];
  const options = value !== "" && !names.includes(value) ? [...names, value] : names;
  // Satu suite saja (atau gagal dimuat) tidak perlu disaring, kecuali filter sudah ada di URL.
  if (options.length < 2 && value === "") return null;
  return (
    <FilterSelect
      label="Suite"
      testId="run-filter-suite"
      allLabel="Semua suite"
      value={value}
      options={options.map((name): [string, string] => [name, name])}
      onChange={onChange}
    />
  );
}

function RunCaseList({
  slug,
  number,
  filters,
  resetFilters,
}: {
  slug: string;
  number: number;
  filters: RunCaseFilters;
  resetFilters: (() => void) | undefined;
}) {
  const fetchPage = useCallback(
    async (cursor?: string) => {
      const page = await api.manual.runCases.list(slug, number, { ...filters, cursor });
      return { items: page.items, nextCursor: page.nextCursor };
    },
    [slug, number, filters],
  );
  const list = useCursorList(fetchPage);
  const groupsId = useId();

  if (list.state === "loading") return <Loading label="Memuat daftar case…" />;
  if (list.state === "error") {
    return <LoadError error={list.error} fallback="Gagal memuat daftar case. Coba lagi." onRetry={list.reload} />;
  }
  if (list.items.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title={resetFilters ? "Tidak ada case yang cocok" : "Run ini belum berisi case"}
        data-testid="run-cases-empty"
        action={
          resetFilters ? (
            <Button type="button" variant="outline" size="sm" onClick={resetFilters} data-testid="run-cases-filter-reset">
              Atur ulang filter
            </Button>
          ) : null
        }
      >
        <p>
          {resetFilters ? "Tidak ada case yang cocok dengan filter ini. Ubah atau atur ulang filter." : "Case yang disalin ke run ini akan muncul di sini."}
        </p>
      </EmptyState>
    );
  }

  const groups = groupBySuite(list.items);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div className="grid min-w-0 gap-4" data-testid="run-case-list">
        {groups.map((group, index) => (
          <div
            key={`${index}:${group.suiteName}`}
            role="group"
            aria-labelledby={`${groupsId}-${index}`}
            className="min-w-0 overflow-hidden rounded-lg border bg-card"
          >
            <h3 id={`${groupsId}-${index}`} className="m-0 border-b bg-muted/50 px-4 py-2 text-sm font-semibold [overflow-wrap:anywhere]">
              {group.suiteName}
            </h3>
            <ul className="m-0 grid list-none divide-y divide-border p-0">
              {group.items.map((item) => (
                <li key={item.id} data-testid={`run-case-row-${item.id}`}>
                  <RunCaseRow slug={slug} number={number} item={item} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="m-0 text-sm text-muted-foreground">
          Menampilkan {list.items.length} case{list.hasMore ? "" : " (semua)"}
        </p>
        {resetFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={resetFilters} data-testid="run-cases-filter-reset">
            Atur ulang filter
          </Button>
        ) : null}
      </div>
      {list.moreError ? (
        <LoadError error={list.moreError} fallback="Gagal memuat case berikutnya. Coba lagi." onRetry={list.loadMore} />
      ) : null}
      {list.hasMore ? (
        <div>
          <Button type="button" variant="outline" onClick={list.loadMore} disabled={list.loadingMore} data-testid="run-cases-load-more">
            {list.loadingMore ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
            Muat lagi
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Baris case: judulnya tautan ke halaman eksekusi; badge bug berupa tautan sendiri sehingga baris bukan satu tautan besar. */
function RunCaseRow({ slug, number, item }: { slug: string; number: number; item: RunCaseListItemDto }) {
  return (
    <div className="grid min-w-0 gap-1.5 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <Link
          to={`/p/${encodeURIComponent(slug)}/manual-runs/${number}/cases/${encodeURIComponent(item.id)}`}
          className="flex min-w-0 items-baseline gap-2 rounded-sm text-foreground no-underline outline-hidden hover:underline focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          <span className="font-mono text-sm text-muted-foreground">{caseCode(item.caseNumber)}</span>
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{item.title}</span>
        </Link>
        <ManualStatus status={item.status} className="text-sm" />
      </div>
      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Prioritas {CASE_PRIORITY_LABEL[item.priority]}</span>
        <span className="min-w-0 [overflow-wrap:anywhere]">{item.assignee ? `Assignee ${item.assignee.name}` : "Belum di-assign"}</span>
        {item.executedAt ? <time dateTime={item.executedAt}>dieksekusi {formatRelativeTime(item.executedAt)}</time> : null}
      </p>
      {item.bugs.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="sr-only">Bug:</span>
          {item.bugs.map((bug) => (
            <BugBadge key={bug.number} bug={bug} slug={slug} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
