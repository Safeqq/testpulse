import { Bug, ClipboardCheck, FolderKanban, LayoutDashboard, Link2, UsersRound, Users, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "./SectionHeading";

interface Feature {
  slug: string;
  icon: LucideIcon;
  title: string;
  description: string;
  /** Tahap rencana bila fitur belum tersedia; kosong berarti sudah live. */
  stage?: number;
}

const FEATURES: Feature[] = [
  {
    slug: "projects",
    icon: FolderKanban,
    title: "Project & visibilitas",
    description: "Satu project per aplikasi yang diuji. Atur publik (hanya-baca untuk siapa saja) atau privat (khusus anggota).",
  },
  {
    slug: "team",
    icon: Users,
    title: "Tim & role",
    description: "Kelola anggota dengan tiga role: admin, tester, dan viewer. Setiap role punya hak akses yang jelas.",
  },
  {
    slug: "invitations",
    icon: Link2,
    title: "Undangan lewat link",
    description: "Undang rekan tim dengan satu link sekali pakai. Tanpa tukar email, tanpa konfigurasi.",
  },
  {
    slug: "dashboard",
    icon: LayoutDashboard,
    title: "Dashboard hasil test & deteksi flaky",
    description: "Kirim hasil test dari CI, lihat tren lulus/gagal, dan temukan test yang tidak stabil.",
  },
  {
    slug: "bug-tracker",
    icon: Bug,
    title: "Bug tracker",
    description: "Catat bug dari temuan test, lengkap dengan status, prioritas, dan penanggung jawab.",
    stage: 3,
  },
  {
    slug: "manual-tests",
    icon: ClipboardCheck,
    title: "Test case manual",
    description: "Susun dan jalankan test case manual berdampingan dengan hasil automated test.",
    stage: 4,
  },
  {
    slug: "crowdtesting",
    icon: UsersRound,
    title: "Crowdtesting",
    description: "Libatkan penguji eksternal untuk menguji rilis Anda di perangkat dan kondisi nyata.",
    stage: 5,
  },
];

export function Features() {
  return (
    <section aria-labelledby="landing-features-title" data-testid="landing-features" className="grid gap-8">
      <SectionHeading id="landing-features-title" eyebrow="Fitur" title="Semua yang dibutuhkan tim QA, bertahap">
        Fondasi dan dashboard hasil test sudah live hari ini. Fitur berikutnya dikerjakan tahap demi tahap.
      </SectionHeading>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ slug, icon: Icon, title, description, stage }) => (
          <li key={slug} className="min-w-0">
            <Card data-testid={`feature-${slug}`} className="h-full gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-foreground">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                {stage ? (
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <Badge variant="secondary" data-testid="feature-soon-badge">
                      Segera
                    </Badge>
                    <Badge variant="outline">Tahap {stage}</Badge>
                  </div>
                ) : (
                  <Badge variant="default">Tersedia</Badge>
                )}
              </div>
              <h3 className="text-base font-semibold tracking-tight">{title}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
