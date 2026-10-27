import { ExternalLink, Code2, FileText, GitBranch, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "./SectionHeading";

const REPO = "https://github.com/Safeqq/testpulse";

// Dari puncak (paling sedikit, paling lambat) ke dasar (paling banyak, paling cepat). Kelas ditulis utuh untuk Tailwind.
const TIERS = [
  { label: "Smoke test production", detail: "Dijalankan setelah setiap deploy", width: "sm:w-[56%]", tint: "bg-primary/5" },
  { label: "OWASP ZAP", detail: "Pemindaian keamanan baseline", width: "sm:w-[63%]", tint: "bg-primary/10" },
  { label: "E2E 3 browser + aksesibilitas", detail: "Chromium, Firefox, WebKit, dua tema", width: "sm:w-[72%]", tint: "bg-primary/15" },
  { label: "API + matriks otorisasi", detail: "Setiap role terhadap endpoint project", width: "sm:w-[80%]", tint: "bg-primary/20" },
  { label: "Contract (Pact)", detail: "Web dan API sepakat soal bentuk data", width: "sm:w-[88%]", tint: "bg-primary/25" },
  { label: "Integration (Postgres asli)", detail: "Database sungguhan, bukan mock", width: "sm:w-[94%]", tint: "bg-primary/30" },
  { label: "Unit", detail: "Aturan domain, schema, dan utilitas", width: "sm:w-full", tint: "bg-primary/35" },
] as const;

// Snapshot dari docs/TEST_STRATEGY.md (bagian "Jumlah test"); jangan diubah tanpa memperbarui dokumen itu.
const SNAPSHOT = {
  commit: "ad6b30d",
  date: "27 Oktober 2026",
  rows: [
    { label: "Integration", value: "125" },
    { label: "API + otorisasi", value: "156" },
    { label: "Contract (consumer)", value: "27" },
    { label: "E2E per browser", value: "77" },
  ],
} as const;

function ExternalLinkButton({
  href,
  testId,
  icon,
  children,
}: {
  href: string;
  testId: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Button asChild variant="outline">
      <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}>
        {icon}
        {children}
        <ExternalLink aria-hidden="true" className="opacity-60" />
        <span className="sr-only">(membuka tab baru)</span>
      </a>
    </Button>
  );
}

export function Quality() {
  return (
    <section aria-labelledby="landing-quality-title" data-testid="landing-quality" className="grid gap-8">
      <SectionHeading id="landing-quality-title" eyebrow="Kualitas" title="Dibangun dengan standar QA">
        TestPulse diuji berlapis, dari unit sampai production. Semua hasilnya terbuka untuk diperiksa.
      </SectionHeading>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5 lg:gap-10">
        <ol className="grid min-w-0 content-start justify-items-center gap-1.5 lg:col-span-3" aria-label="Piramida test, dari puncak ke dasar">
          {TIERS.map((tier) => (
            <li
              key={tier.label}
              className={`w-full min-w-0 rounded-lg border px-4 py-2.5 text-center text-foreground ${tier.width} ${tier.tint}`}
            >
              <span className="block text-sm font-semibold">{tier.label}</span>
              <span className="block text-xs text-foreground">{tier.detail}</span>
            </li>
          ))}
        </ol>

        <div className="grid min-w-0 content-start gap-6 lg:col-span-2">
          <div className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
            <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <ShieldCheck aria-hidden="true" className="size-5 text-link" />
              Jumlah test (snapshot)
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              {SNAPSHOT.rows.map((row) => (
                <div key={row.label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{row.label}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Snapshot per commit {SNAPSHOT.commit}, {SNAPSHOT.date}; akan bergeser seiring pengembangan. Angka
              terkini ada di laporan Allure, rincian di <code className="font-mono">docs/TEST_STRATEGY.md</code>.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <ExternalLinkButton
              href="https://safeqq.github.io/testpulse/"
              testId="quality-link-allure"
              icon={<FileText aria-hidden="true" />}
            >
              Laporan test live
            </ExternalLinkButton>
            <ExternalLinkButton
              href={`${REPO}/actions/workflows/ci.yml`}
              testId="quality-link-ci"
              icon={<GitBranch aria-hidden="true" />}
            >
              CI
            </ExternalLinkButton>
            <ExternalLinkButton href={REPO} testId="quality-link-source" icon={<Code2 aria-hidden="true" />}>
              Source code
            </ExternalLinkButton>
            <ExternalLinkButton
              href={`${REPO}/blob/main/docs/TEST_STRATEGY.md`}
              testId="quality-link-strategy"
              icon={<FileText aria-hidden="true" />}
            >
              Strategi test
            </ExternalLinkButton>
          </div>
        </div>
      </div>
    </section>
  );
}
