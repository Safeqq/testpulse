import type { ManualCaseDto, ProjectDto } from "@testpulse/shared";
import { Archive, ArchiveRestore, ArrowLeft, Bot, ClipboardList, Loader2, Pencil } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CaseDeleteControl } from "@/components/CaseDeleteControl";
import { EmptyState } from "@/components/EmptyState";
import { FormError } from "@/components/FormError";
import { INLINE_LINK_CLASS } from "@/components/inlineLink";
import { LazyMarkdown } from "@/components/LazyMarkdown";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { ManualStatus } from "@/components/ManualStatus";
import { RunStatus } from "@/components/RunStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { errorMessage, useDocumentTitle } from "@/lib/forms";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { caseCode, CASE_PRIORITY_LABEL, parseCaseNumber } from "@/lib/manual";
import { useLoad } from "@/lib/useLoad";
import { preloadPages } from "./lazyPages";
import { BACK_LINK_CLASS, ProjectFrame } from "./ProjectFrame";

/** `/p/:slug/cases/:number`: detail test case (prasyarat, langkah, kartu otomasi, riwayat eksekusi) dengan edit, arsip, dan hapus. */
export function CasePage() {
  const { slug = "", number = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title={`TC-${number}`} tab="manual">
      {(project) => <CaseLoader project={project} number={parseCaseNumber(number)} />}
    </ProjectFrame>
  );
}

function CaseNotFound({ slug }: { slug: string }) {
  return (
    <EmptyState icon={ClipboardList} title="Case tidak ditemukan" headingLevel="h1" data-testid="case-not-found">
      <p>Case ini tidak ada di project ini, atau sudah dihapus.</p>
      <Link to={`/p/${encodeURIComponent(slug)}/cases`} className={BACK_LINK_CLASS}>
        Ke daftar case
      </Link>
    </EmptyState>
  );
}

function CaseLoader({ project, number }: { project: ProjectDto; number: number | null }) {
  const fetchCase = useCallback(
    () =>
      number === null
        ? Promise.reject(new ApiError(404, "CASE_NOT_FOUND", "Case tidak ditemukan"))
        : api.manual.cases.get(project.slug, number),
    [project.slug, number],
  );
  const load = useLoad(fetchCase);
  if (load.state === "loading") return <Loading label="Memuat case…" />;
  if (load.state === "error") {
    if (load.error instanceof ApiError && load.error.code === "CASE_NOT_FOUND") return <CaseNotFound slug={project.slug} />;
    return <LoadError error={load.error} fallback="Gagal memuat case. Coba lagi." onRetry={load.reload} />;
  }
  return <CaseView key={`${project.slug}:${number}`} project={project} initial={load.data} />;
}

function CaseView({ project, initial }: { project: ProjectDto; initial: ManualCaseDto }) {
  const { slug } = project;
  const navigate = useNavigate();
  const [item, setItem] = useState(initial);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const canWrite = project.myRole === "tester" || project.myRole === "admin";
  const isAdmin = project.myRole === "admin";
  const code = caseCode(item.number);
  useEffect(() => preloadPages("caseForm"), []);
  const archived = item.archivedAt !== null;
  const base = `/p/${encodeURIComponent(slug)}`;
  useDocumentTitle(`${code} · ${item.title}`);

  /** Arsipkan/pulihkan dengan `version` yang sedang dilihat; konflik menampilkan banner dan tidak mengubah apa pun. */
  async function toggleArchive() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      setItem(await api.manual.cases.update(slug, item.number, { version: item.version, archived: !archived }));
      setConflict(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "CASE_CONFLICT") setConflict(true);
      else setActionError(errorMessage(err, "Gagal menyimpan perubahan. Coba lagi."));
    } finally {
      setBusy(false);
    }
  }

  /** Memuat ulang case dari server (setelah konflik atau kapan saja). */
  async function reload() {
    setBusy(true);
    try {
      setItem(await api.manual.cases.get(slug, item.number));
      setConflict(false);
      setActionError(null);
    } catch (err) {
      setActionError(errorMessage(err, "Gagal memuat ulang case. Coba lagi."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await api.manual.cases.remove(slug, item.number);
    } catch (err) {
      // Sudah terhapus (mis. di tab lain): hasil akhirnya sama dengan hapus yang berhasil.
      if (!(err instanceof ApiError && err.code === "CASE_NOT_FOUND")) throw err;
    }
    navigate(`${base}/cases`, { replace: true });
  }

  return (
    <article aria-label={`Case ${code}`} className="grid min-w-0 grid-cols-1 gap-6">
      <div className="grid min-w-0 gap-3">
        <Link to={`${base}/cases`} className={BACK_LINK_CLASS} data-testid="case-back">
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          Daftar case
        </Link>
        {conflict ? (
          <div
            role="alert"
            data-testid="case-conflict"
            className="grid justify-items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <div className="grid gap-1">
              <p className="m-0 font-semibold">Case ini baru saja diubah orang lain</p>
              <p className="m-0">Muat ulang untuk melihat versi terbaru, lalu ulangi perubahanmu.</p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void reload()} data-testid="case-conflict-reload">
              {busy ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              Muat ulang case
            </Button>
          </div>
        ) : null}
        <FormError message={actionError} />
        <p className="m-0 text-sm text-muted-foreground" data-testid="case-meta">
          <span className="font-mono">{code}</span> · dibuat oleh <span className="font-medium text-foreground">{item.createdBy.name}</span>{" "}
          <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
            {formatRelativeTime(item.createdAt)}
          </time>
          {item.updatedAt !== item.createdAt ? (
            <>
              {" · "}diubah oleh <span className="font-medium text-foreground">{item.updatedBy.name}</span>{" "}
              <time dateTime={item.updatedAt} title={formatDateTime(item.updatedAt)}>
                {formatRelativeTime(item.updatedAt)}
              </time>
            </>
          ) : null}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]" data-testid="case-title">
          {item.title}
        </h1>
        {archived ? (
          <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="case-archived">
            <Badge variant="outline">Diarsipkan</Badge>
            Case ini tidak bisa dipilih untuk run baru. Riwayat run tetap ada.
          </p>
        ) : null}
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`${base}/cases/${item.number}/edit`} data-testid="case-edit">
                <Pencil aria-hidden="true" />
                Edit
              </Link>
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void toggleArchive()} data-testid="case-archive">
              {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
              {archived ? "Pulihkan" : "Arsipkan"}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-6 lg:col-start-1">
          <section aria-labelledby="case-preconditions-title" className="grid min-w-0 gap-2">
            <h2 id="case-preconditions-title" className="text-lg font-semibold tracking-tight">
              Prasyarat
            </h2>
            <div className="min-w-0" data-testid="case-preconditions">
              {item.preconditions.trim() === "" ? (
                <p className="m-0 text-sm text-muted-foreground">Tidak ada prasyarat.</p>
              ) : (
                <LazyMarkdown source={item.preconditions} />
              )}
            </div>
          </section>

          <section aria-labelledby="case-steps-title" className="grid min-w-0 gap-3">
            <h2 id="case-steps-title" className="text-lg font-semibold tracking-tight">
              Langkah <span className="text-sm font-normal text-muted-foreground">({item.steps.length})</span>
            </h2>
            <ol className="m-0 grid list-none gap-3 p-0" data-testid="case-steps">
              {item.steps.map((step, index) => (
                <li key={index} className="grid min-w-0 gap-3 rounded-lg border bg-card p-4 md:grid-cols-2" data-testid={`case-step-${index}`}>
                  <div className="grid min-w-0 content-start gap-1.5">
                    <p className="m-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Langkah {index + 1} · Aksi</p>
                    <div className="min-w-0">
                      <LazyMarkdown source={step.action} />
                    </div>
                  </div>
                  <div className="grid min-w-0 content-start gap-1.5">
                    <p className="m-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Hasil yang diharapkan</p>
                    <div className="min-w-0">
                      {step.expected.trim() === "" ? (
                        <p className="m-0 text-sm text-muted-foreground">–</p>
                      ) : (
                        <LazyMarkdown source={step.expected} />
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <History slug={slug} item={item} />
        </div>

        <aside
          aria-label="Detail case"
          className="grid min-w-0 content-start gap-5 rounded-xl border bg-card p-5 text-card-foreground lg:col-start-2 lg:row-start-1"
        >
          <dl className="m-0 grid min-w-0 gap-3 text-sm">
            <div className="grid min-w-0 gap-0.5">
              <dt className="text-muted-foreground">Suite</dt>
              <dd className="m-0 min-w-0 font-medium [overflow-wrap:anywhere]" data-testid="case-suite">
                {item.suite.name}
              </dd>
            </div>
            <div className="grid min-w-0 gap-0.5">
              <dt className="text-muted-foreground">Prioritas</dt>
              <dd className="m-0 min-w-0 font-medium" data-testid="case-priority">
                {CASE_PRIORITY_LABEL[item.priority]}
              </dd>
            </div>
            <div className="grid min-w-0 gap-1">
              <dt className="text-muted-foreground">Label</dt>
              <dd className="m-0 min-w-0" data-testid="case-labels">
                {item.labels.length === 0 ? (
                  <span className="text-muted-foreground">Tanpa label</span>
                ) : (
                  <ul className="m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0">
                    {item.labels.map((label) => (
                      <li key={label} className="max-w-full">
                        <Badge variant="secondary" className="max-w-full">
                          <span className="min-w-0 truncate">{label}</span>
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
          <Automation slug={slug} item={item} />
          {isAdmin ? (
            <div className="border-t pt-4">
              <CaseDeleteControl code={code} onDelete={remove} />
            </div>
          ) : null}
        </aside>
      </div>
    </article>
  );
}

/** Kartu otomasi (spec Tahap 4 §5.3, §8.4): test tertaut beserta status terakhirnya di branch default, atau "Belum diotomasi". */
function Automation({ slug, item }: { slug: string; item: ManualCaseDto }) {
  const test = item.automatedTest;
  const base = `/p/${encodeURIComponent(slug)}`;
  return (
    <section aria-labelledby="case-automation-title" className="grid min-w-0 gap-2 border-t pt-4" data-testid="case-automation">
      <h2 id="case-automation-title" className="flex items-center gap-2 text-base font-semibold tracking-tight">
        <Bot className="size-4 shrink-0" aria-hidden="true" />
        Otomasi
      </h2>
      {test === null ? (
        <p className="m-0 text-sm text-muted-foreground">Belum diotomasi</p>
      ) : (
        <>
          <p className="m-0 text-sm [overflow-wrap:anywhere]">
            <Link to={`${base}/tests/${test.id}`} className={INLINE_LINK_CLASS} data-testid="case-automation-test">
              {test.suite} › {test.name}
            </Link>
          </p>
          {test.lastResult ? (
            <p className="m-0 flex flex-wrap items-center gap-x-1.5 text-sm" data-testid="case-automation-status">
              <RunStatus outcome={test.lastResult.status} />
              <span className="[overflow-wrap:anywhere]">di {test.lastResult.branch}</span>
              <span aria-hidden="true">·</span>
              <Link to={`${base}/runs/${test.lastResult.runId}`} className={INLINE_LINK_CLASS}>
                <time dateTime={test.lastResult.createdAt} title={formatDateTime(test.lastResult.createdAt)}>
                  {formatRelativeTime(test.lastResult.createdAt)}
                </time>
              </Link>
            </p>
          ) : (
            <p className="m-0 text-sm text-muted-foreground" data-testid="case-automation-status">
              Belum ada hasil di branch default.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Riwayat eksekusi (spec Tahap 4 §8.4): hasil case ini pada run manual, maksimal 10, terbaru dulu, masing-masing menaut ke halaman eksekusinya. */
function History({ slug, item }: { slug: string; item: ManualCaseDto }) {
  const base = `/p/${encodeURIComponent(slug)}`;
  return (
    <section aria-labelledby="case-history-title" className="grid min-w-0 gap-3" data-testid="case-history">
      <h2 id="case-history-title" className="text-lg font-semibold tracking-tight">
        Riwayat eksekusi
      </h2>
      {item.recentResults.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">Case ini belum pernah masuk run manual.</p>
      ) : (
        <ul className="m-0 grid list-none divide-y divide-border rounded-lg border bg-card p-0">
          {item.recentResults.map((result) => (
            <li key={result.runCaseId} data-testid={`case-history-row-${result.runNumber}`}>
              <Link
                to={`${base}/manual-runs/${result.runNumber}/cases/${result.runCaseId}`}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-sm text-foreground no-underline outline-hidden hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="font-mono text-muted-foreground">TR-{result.runNumber}</span>
                <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                  {result.runName}
                  {result.appVersion ? ` ${result.appVersion}` : ""}
                </span>
                <ManualStatus status={result.status} />
                {result.executedAt ? (
                  <time dateTime={result.executedAt} title={formatDateTime(result.executedAt)} className="text-muted-foreground">
                    {formatRelativeTime(result.executedAt)}
                  </time>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
