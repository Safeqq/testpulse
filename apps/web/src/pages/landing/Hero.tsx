import { ArrowRight, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const STATS = [
  { label: "Lulus", value: "248", dot: "bg-primary" },
  { label: "Gagal", value: "6", dot: "bg-destructive" },
  { label: "Flaky", value: "3", dot: "bg-amber-500" },
] as const;

// Tinggi batang (persen) per run, dari lama ke baru. Kelas ditulis utuh agar terbaca oleh Tailwind.
const BARS = [
  "h-[58%]",
  "h-[64%]",
  "h-[52%]",
  "h-[70%]",
  "h-[76%]",
  "h-[68%]",
  "h-[82%]",
  "h-[74%]",
  "h-[88%]",
  "h-[80%]",
  "h-[92%]",
  "h-[86%]",
] as const;

/** Mockup dashboard statis: data contoh, bukan data nyata. Dibangun dari komponen dan kelas Tailwind (aman CSP). */
function DashboardPreview() {
  return (
    <Card
      role="group"
      aria-label="Pratinjau dashboard TestPulse"
      className="w-full min-w-0 gap-4 overflow-hidden py-0 shadow-md"
    >
      <div className="flex items-center justify-between gap-3 border-b bg-muted px-4 py-2.5">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-muted-foreground/40" />
          <span className="size-2.5 rounded-full bg-muted-foreground/40" />
          <span className="size-2.5 rounded-full bg-muted-foreground/40" />
        </div>
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">proyek-contoh / main</span>
        <Badge variant="outline" className="bg-card">
          <Eye aria-hidden="true" />
          Pratinjau
        </Badge>
      </div>

      <div className="grid gap-4 px-4">
        <dl className="grid grid-cols-3 gap-2 sm:gap-3">
          {STATS.map((stat) => (
            <div key={stat.label} className="min-w-0 rounded-lg border bg-background px-3 py-2.5">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${stat.dot}`} />
                {stat.label}
              </dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{stat.value}</dd>
            </div>
          ))}
        </dl>

        <div>
          <p className="text-xs font-medium text-muted-foreground">Tren lulus per run (contoh)</p>
          <div
            className="mt-2 flex h-28 items-end gap-1 rounded-lg border bg-background px-2 pt-2 sm:h-32 sm:gap-1.5"
            aria-hidden="true"
          >
            {BARS.map((height, index) => (
              <div key={index} className="flex h-full min-w-0 flex-1 items-end">
                <div className={`w-full rounded-t-sm bg-primary ${height}`} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">Data contoh, bukan data nyata.</p>
    </Card>
  );
}

export function Hero() {
  return (
    <section
      aria-labelledby="landing-hero-title"
      data-testid="landing-hero"
      className="grid grid-cols-1 items-center gap-10 pt-4 lg:grid-cols-2 lg:gap-12 lg:pt-8"
    >
      <div className="min-w-0">
        <h1 id="landing-hero-title" className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Pantau kesehatan testing tim Anda di satu tempat.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted-foreground">
          Kumpulkan hasil automated test dari CI dan deteksi test flaky dalam satu platform untuk tim QA, lalu
          bertahap menambah bug report, test case manual, dan crowdtesting.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link to="/register" data-testid="landing-cta-register">
              Daftar gratis
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/p/testpulse" data-testid="landing-cta-demo">
              Lihat demo project publik
            </Link>
          </Button>
        </div>
      </div>
      <DashboardPreview />
    </section>
  );
}
