import type { ManualSummaryDto } from "@testpulse/shared";
import type { FastifyInstance } from "fastify";
import { withStatementTimeout } from "../../db/client.js";
import { loadUser } from "../auth/service.js";
import { resolveProject } from "../projects/access.js";
import { READ_STATEMENT_TIMEOUT_MS, type ReadRoutesOptions } from "../results/read.routes.js";
import { caseCoverage } from "./cases.repository.js";
import { listManualRuns } from "./runs.repository.js";

/**
 * Ringkasan test manual untuk kartu dashboard (spec Tahap 4 §5.2): run terbaru (nomor TR terbesar, Ruling R5) dan
 * cakupan otomasi case aktif. API hanya mengirim hitungan; persen dihitung klien dengan `coveragePercent` shared.
 * Hanya sesi cookie yang dibaca (token CI = anonim); kedua query dalam satu transaksi baca-saja ber-`statement_timeout`
 * agar run dan cakupan berasal dari snapshot yang sama.
 */
export async function manualSummaryRoutes(app: FastifyInstance, opts: ReadRoutesOptions = {}): Promise<void> {
  const readAccess = { preHandler: [loadUser] };
  const statementTimeoutMs = opts.statementTimeoutMs ?? READ_STATEMENT_TIMEOUT_MS;

  app.get<{ Params: { slug: string } }>(
    "/projects/:slug/manual/summary",
    readAccess,
    async (req): Promise<ManualSummaryDto> => {
      const { project } = await resolveProject(app.db, req.params.slug, req.user, "project:read");
      return withStatementTimeout(app.db, statementTimeoutMs, async (db) => {
        const [latestRun] = await listManualRuns(db, { projectId: project.id, query: { status: "all" }, limit: 1 });
        return { latestRun: latestRun ?? null, coverage: await caseCoverage(db, project.id) };
      });
    },
  );
}
