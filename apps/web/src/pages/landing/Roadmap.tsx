import { CheckCircle2, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "./SectionHeading";

const STAGES = [
  { stage: 1, title: "Akun, project, tim, dan undangan", status: "Live", live: true },
  { stage: 2, title: "Dashboard hasil test & deteksi flaky", status: "Berikutnya" },
  { stage: 3, title: "Bug tracker", status: "Direncanakan" },
  { stage: 4, title: "Test case manual", status: "Direncanakan" },
  { stage: 5, title: "Crowdtesting", status: "Direncanakan" },
  { stage: 6, title: "Aplikasi desktop", status: "Opsional" },
] as const;

export function Roadmap() {
  return (
    <section aria-labelledby="landing-roadmap-title" data-testid="landing-roadmap" className="grid gap-8">
      <SectionHeading id="landing-roadmap-title" eyebrow="Roadmap" title="Dikerjakan bertahap" />
      <ol className="grid max-w-2xl gap-0">
        {STAGES.map((item, index) => {
          const live = "live" in item;
          const last = index === STAGES.length - 1;
          return (
            <li key={item.stage} className="relative flex gap-4 pb-6 last:pb-0">
              {!last ? <span aria-hidden="true" className="absolute top-8 bottom-0 left-[0.8125rem] w-px bg-border" /> : null}
              <span
                aria-hidden="true"
                className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-background"
              >
                {live ? (
                  <CheckCircle2 className="size-6 text-link" />
                ) : (
                  <Circle className="size-5 text-muted-foreground" />
                )}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">Tahap {item.stage}</span>
                  <Badge variant={live ? "default" : item.status === "Berikutnya" ? "secondary" : "outline"}>
                    {item.status}
                  </Badge>
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{item.title}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
