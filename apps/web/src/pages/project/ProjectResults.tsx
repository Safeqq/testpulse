import type { BranchDto, ProjectDto } from "@testpulse/shared";
import { BarChart3, Terminal } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChunkErrorBoundary } from "@/components/ChunkErrorBoundary";
import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { curlExample } from "@/lib/ingest";
import { useLoad } from "@/lib/useLoad";
import { BranchFilter } from "./BranchFilter";

// Dashboard (grafik + kartu) dipecah ke chunk sendiri agar bundle utama tidak bertambah; baru diunduh bila project punya run.
const loadDashboard = () => import("./Dashboard").then((m) => ({ default: m.Dashboard }));
const Dashboard = lazy(loadDashboard);

/** Hasil test project: dashboard bila sudah ada run; jika belum, panduan setup (anggota) atau keadaan kosong (pengunjung). */
export function ProjectResults({ project }: { project: ProjectDto }) {
  const { slug } = project;
  const fetchBranches = useCallback(() => api.results.branches(slug), [slug]);
  const load = useLoad(fetchBranches);

  // Unduh chunk dashboard bersamaan dengan daftar branch, bukan menunggu sampai branch selesai dimuat.
  useEffect(() => {
    // Kegagalan unduh awal ini diabaikan (tanpa unhandled rejection): `lazy` memuat chunk lagi saat Dashboard dirender,
    // dan kegagalan di sana ditangani ChunkErrorBoundary.
    loadDashboard().catch(() => undefined);
  }, []);

  if (load.state === "loading") return <Loading label="Memuat hasil test…" />;
  if (load.state === "error") {
    return <LoadError error={load.error} fallback="Gagal memuat hasil test. Coba lagi." onRetry={load.reload} />;
  }

  if (load.data.length === 0) {
    return project.myRole === null ? (
      <EmptyState icon={BarChart3} title="Belum ada hasil test" data-testid="empty-results">
        <p>Dashboard hasil test akan tampil di sini setelah pipeline CI project ini mengunggah laporan pertamanya.</p>
      </EmptyState>
    ) : (
      <SetupInstructions project={project} />
    );
  }

  return <BranchDashboard slug={slug} branches={load.data} />;
}

/** Default `main` bila ada; jika tidak, branch run terbaru (API mengurutkan branch dari yang terbaru). */
export function defaultBranch(branches: BranchDto[]): string {
  return branches.find((b) => b.branch === "main")?.branch ?? branches[0]?.branch ?? "main";
}

/**
 * Pemilih branch tetap di bundle utama, di luar Suspense. WebKit melaporkan style-src-attr palsu untuk setiap <select>
 * (artefak mesin yang dimaklumi penjaga CSP E2E bila target event-nya <select>); bila select dibuat di dalam subtree
 * Suspense, WebKit mengarahkan event itu ke document sehingga artefaknya tak lagi bisa dibedakan dari pelanggaran asli.
 */
function BranchDashboard({ slug, branches }: { slug: string; branches: BranchDto[] }) {
  const [branch, setBranch] = useState(() => defaultBranch(branches));
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <BranchFilter
        id="dashboard-branch"
        testId="dashboard-branch"
        branches={branches}
        value={branch}
        onChange={setBranch}
      />
      <ChunkErrorBoundary>
        <Suspense fallback={<Loading label="Memuat dashboard…" />}>
          <Dashboard slug={slug} branch={branch} />
        </Suspense>
      </ChunkErrorBoundary>
    </div>
  );
}

/** Panduan unggah laporan pertama untuk anggota; token dibuat admin di pengaturan. */
function SetupInstructions({ project }: { project: ProjectDto }) {
  const { slug } = project;
  return (
    <Card data-testid="setup-instructions">
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Terminal className="size-5" aria-hidden="true" />
            Belum ada hasil test
          </h2>
        </CardTitle>
        <CardDescription>
          Unggah laporan JUnit XML dari pipeline CI ke <code className="font-mono">/api/v1/projects/{slug}/runs</code>{" "}
          untuk mengisi dashboard ini.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <ol className="m-0 grid list-decimal gap-2 pl-5">
          <li>
            {project.myRole === "admin" ? (
              <>
                Buat token di{" "}
                <Link
                  to={`/p/${slug}/settings#tokens`}
                  className="rounded-sm font-medium text-link underline underline-offset-4 outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  Pengaturan → Token CI
                </Link>
                , lalu simpan sebagai rahasia di pipeline Anda.
              </>
            ) : (
              <>Minta admin project membuat token CI di Pengaturan, lalu simpan sebagai rahasia di pipeline Anda.</>
            )}
          </li>
          <li>Unggah laporan JUnit XML dengan token tersebut, misalnya dengan curl berikut.</li>
        </ol>
        <pre
          className="m-0 rounded-md border bg-background px-3 py-2 font-mono text-sm break-all whitespace-pre-wrap"
        >
          {curlExample(slug, "$TESTPULSE_TOKEN")}
        </pre>
        <p className="m-0 text-muted-foreground">
          Parameter <code className="font-mono">branch</code> wajib; <code className="font-mono">commit</code>,{" "}
          <code className="font-mono">ciUrl</code>, dan <code className="font-mono">name</code> opsional.
        </p>
      </CardContent>
    </Card>
  );
}
