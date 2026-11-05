import type { BugDto, BugStatus, ProjectDto } from "@testpulse/shared";
import { ArrowLeft, Bug as BugIcon, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BugActivity } from "@/components/BugActivity";
import { BugDeleteControl } from "@/components/BugDeleteControl";
import { BugDescription } from "@/components/BugDescription";
import { BugFields } from "@/components/BugFields";
import { BugLabelsEditor } from "@/components/BugLabelsEditor";
import { BugLinksEditor } from "@/components/BugLinksEditor";
import { BugStatus as BugStatusLabel } from "@/components/BugStatus";
import { BugTestOrigin } from "@/components/BugTestOrigin";
import { BugTitleEditor } from "@/components/BugTitleEditor";
import { BugTransitions } from "@/components/BugTransitions";
import { EmptyState } from "@/components/EmptyState";
import { FormError } from "@/components/FormError";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { BugPatch } from "@/lib/bugForm";
import { toSaveFailure, type SaveResult } from "@/lib/bugSave";
import { BUG_STATUS_LABEL } from "@/lib/bugs";
import { errorMessage, useDocumentTitle } from "@/lib/forms";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { useBugActivity } from "@/lib/useBugActivity";
import { useLoad } from "@/lib/useLoad";
import { BACK_LINK_CLASS, ProjectFrame } from "./ProjectFrame";

const MAX_BUG_NUMBER = 2_147_483_647;

/** Nomor bug dari URL; `null` untuk apa pun yang bukan bilangan bulat positif yang mungkin ada. */
export function parseBugNumber(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const value = Number(raw);
  return value <= MAX_BUG_NUMBER ? value : null;
}

/** `/p/:slug/bugs/:number`: detail bug dengan transisi, edit inline, komentar, dan riwayat (spec Tahap 3 §7.5). */
export function BugPage() {
  const { slug = "", number = "" } = useParams();
  return (
    <ProjectFrame slug={slug} title={`Bug #${number}`} tab="bug">
      {(project) => <BugLoader project={project} number={parseBugNumber(number)} />}
    </ProjectFrame>
  );
}

function BugNotFound({ slug }: { slug: string }) {
  return (
    <EmptyState icon={BugIcon} title="Bug tidak ditemukan" headingLevel="h1" data-testid="bug-not-found">
      <p>Bug ini tidak ada di project ini, atau sudah dihapus.</p>
      <Link to={`/p/${encodeURIComponent(slug)}/bugs`} className={BACK_LINK_CLASS}>
        Ke daftar bug
      </Link>
    </EmptyState>
  );
}

function BugLoader({ project, number }: { project: ProjectDto; number: number | null }) {
  const fetchBug = useCallback(
    () => (number === null ? Promise.reject(new ApiError(404, "BUG_NOT_FOUND", "Bug tidak ditemukan")) : api.bugs.get(project.slug, number)),
    [project.slug, number],
  );
  const load = useLoad(fetchBug);
  if (load.state === "loading") return <Loading label="Memuat bug…" />;
  if (load.state === "error") {
    if (load.error instanceof ApiError && load.error.code === "BUG_NOT_FOUND") return <BugNotFound slug={project.slug} />;
    return <LoadError error={load.error} fallback="Gagal memuat bug. Coba lagi." onRetry={load.reload} />;
  }
  return <BugView key={`${project.slug}:${number}`} project={project} initial={load.data} />;
}

function BugView({ project, initial }: { project: ProjectDto; initial: BugDto }) {
  const { slug } = project;
  const number = initial.number;
  const navigate = useNavigate();
  const { user } = useAuth();
  const [bug, setBug] = useState(initial);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  // Naik setiap bug dimuat ulang setelah konflik: editor inline di-mount ulang sehingga draf yang tertinggal terbuang.
  const [epoch, setEpoch] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const saving = useRef(false);
  // Versi terakhir yang dilihat, diperbarui sinkron dari respons PATCH (bukan menunggu render) agar simpan berikutnya tidak memakai versi lama.
  const versionRef = useRef(initial.version);
  const [statusAnnouncement, setStatusAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const activity = useBugActivity(slug, number);
  const canWrite = project.myRole === "tester" || project.myRole === "admin";
  const isAdmin = project.myRole === "admin";
  useDocumentTitle(`Bug #${number} · ${bug.title}`);

  const fetchMembers = useCallback(() => (canWrite ? api.members.list(slug) : Promise.resolve([])), [canWrite, slug]);
  const members = useLoad(fetchMembers);

  // Setelah memuat ulang, fokus ke judul agar pengguna tidak kehilangan posisi (tombol muat ulang menghilang).
  useEffect(() => {
    if (epoch > 0) headingRef.current?.focus();
  }, [epoch]);

  /** Menyimpan perubahan dengan `version` terakhir yang dilihat; hasilnya dikembalikan ke editor pemanggil. */
  async function save(patch: BugPatch): Promise<SaveResult> {
    if (saving.current) return { ok: false, message: "Perubahan sebelumnya masih disimpan. Coba lagi sebentar lagi." };
    saving.current = true;
    setActionError(null);
    try {
      const next = await api.bugs.update(slug, number, { ...patch, version: versionRef.current });
      versionRef.current = next.version;
      setBug(next);
      void activity.refresh();
      return { ok: true };
    } catch (err) {
      const failure = toSaveFailure(err);
      if (failure.conflict) setConflict(true);
      return failure;
    } finally {
      saving.current = false;
    }
  }

  /** Seperti `save`, untuk kontrol tanpa tempat menampilkan galat sendiri: pesannya tampil di atas halaman. */
  async function saveShowingErrors(patch: BugPatch, handledFields: readonly string[]): Promise<SaveResult> {
    const result = await save(patch);
    const handled = Object.keys(result.ok ? {} : (result.fields ?? {})).some((key) => handledFields.includes(key));
    if (!result.ok && !result.conflict && !handled) setActionError(result.message ?? "Gagal menyimpan perubahan.");
    return result;
  }

  async function transition(to: BugStatus, resolution: BugDto["resolution"] | undefined): Promise<SaveResult> {
    // Galat `resolution` ditampilkan oleh pilihan resolusi sendiri; selebihnya (mis. transisi ditolak) di atas halaman.
    const result = await saveShowingErrors({ status: to, ...(resolution ? { resolution } : {}) }, ["resolution"]);
    if (result.ok) {
      // Tombol yang diklik hilang setelah status berubah: fokus pindah ke status agar tidak jatuh ke awal halaman.
      statusRef.current?.focus();
      setStatusAnnouncement(`Status diubah menjadi ${BUG_STATUS_LABEL[to]}`);
    }
    return result;
  }

  async function reload() {
    setReloading(true);
    try {
      const latest = await api.bugs.get(slug, number);
      versionRef.current = latest.version;
      setBug(latest);
      setConflict(false);
      setActionError(null);
      setEpoch((n) => n + 1);
      void activity.refresh();
    } catch (err) {
      setActionError(errorMessage(err, "Gagal memuat ulang bug. Coba lagi."));
    } finally {
      setReloading(false);
    }
  }

  async function remove() {
    try {
      await api.bugs.remove(slug, number);
    } catch (err) {
      // Sudah terhapus (mis. di tab lain): hasil akhirnya sama dengan hapus yang berhasil.
      if (!(err instanceof ApiError && err.code === "BUG_NOT_FOUND")) throw err;
    }
    navigate(`/p/${encodeURIComponent(slug)}/bugs`, { replace: true });
  }

  return (
    <article aria-label={`Bug #${number}`} className="grid min-w-0 grid-cols-1 gap-6">
      <div className="grid min-w-0 gap-3">
        <Link to={`/p/${encodeURIComponent(slug)}/bugs`} className={BACK_LINK_CLASS} data-testid="bug-back">
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          Daftar bug
        </Link>
        {conflict ? (
          <div
            role="alert"
            data-testid="bug-conflict"
            className="grid justify-items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <div className="grid gap-1">
              <p className="m-0 font-semibold">Bug ini baru saja diubah orang lain</p>
              <p className="m-0">Muat ulang untuk melihat versi terbaru. Perubahan yang belum tersimpan di sini akan dibuang.</p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={reloading} onClick={() => void reload()} data-testid="bug-conflict-reload">
              {reloading ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              Muat ulang bug
            </Button>
          </div>
        ) : null}
        <FormError message={actionError} />
        <p className="m-0 text-sm text-muted-foreground" data-testid="bug-meta">
          Bug #{number} · dilaporkan oleh <span className="font-medium text-foreground">{bug.reporter.name}</span>{" "}
          <time dateTime={bug.createdAt} title={formatDateTime(bug.createdAt)}>
            {formatRelativeTime(bug.createdAt)}
          </time>
          {bug.updatedAt !== bug.createdAt ? (
            <>
              {" · "}diubah{" "}
              <time dateTime={bug.updatedAt} title={formatDateTime(bug.updatedAt)}>
                {formatRelativeTime(bug.updatedAt)}
              </time>
            </>
          ) : null}
        </p>
        <BugTitleEditor key={`title-${epoch}`} title={bug.title} canEdit={canWrite} headingRef={headingRef} onSave={save} />
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span ref={statusRef} tabIndex={-1} className="outline-hidden" data-testid="bug-status">
            <span className="sr-only">Status: </span>
            <BugStatusLabel status={bug.status} resolution={bug.resolution} />
          </span>
          <p role="status" aria-live="polite" className="sr-only" data-testid="bug-status-live">
            {statusAnnouncement}
          </p>
        </div>
        {canWrite ? <BugTransitions key={`transitions-${epoch}`} status={bug.status} onTransition={transition} /> : null}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 lg:col-start-1">
          <BugDescription key={`description-${epoch}`} description={bug.description} canEdit={canWrite} onSave={save} />
        </div>
        <aside
          aria-label="Detail bug"
          className="grid min-w-0 content-start gap-5 rounded-xl border bg-card p-5 text-card-foreground lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          <BugFields
            key={`fields-${epoch}`}
            bug={bug}
            members={members.state === "ready" ? members.data : []}
            canEdit={canWrite}
            onSave={save}
          />
          <div className="border-t pt-4">
            <BugLabelsEditor key={`labels-${epoch}`} labels={bug.labels} canEdit={canWrite} onSave={save} />
          </div>
          <div className="border-t pt-4">
            <BugLinksEditor key={`links-${epoch}`} links={bug.links} canEdit={canWrite} onSave={save} />
          </div>
          {bug.testCase ? (
            <div className="border-t pt-4">
              <BugTestOrigin slug={slug} bug={bug} />
            </div>
          ) : null}
          {isAdmin ? (
            <div className="border-t pt-4">
              <BugDeleteControl number={number} onDelete={remove} />
            </div>
          ) : null}
        </aside>
        <div className="min-w-0 lg:col-start-1">
          <BugActivity slug={slug} number={number} activity={activity} userId={user?.id ?? null} canWrite={canWrite} isAdmin={isAdmin} />
        </div>
      </div>
    </article>
  );
}
