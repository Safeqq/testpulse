import { SectionHeading } from "./SectionHeading";

const STEPS = [
  {
    title: "Buat project & undang tim",
    description: "Daftar, buat project untuk aplikasi Anda, lalu undang rekan tim lewat link dengan role yang sesuai.",
  },
  {
    title: "Hubungkan CI dengan reporter",
    description: "Pasang reporter di pipeline CI agar hasil automated test terkirim otomatis setiap run.",
  },
  {
    title: "Pantau tren & perbaiki test flaky",
    description: "Lihat tren kesehatan testing dari waktu ke waktu dan tindak lanjuti test yang tidak stabil.",
  },
] as const;

export function HowItWorks() {
  return (
    <section aria-labelledby="landing-how-title" data-testid="landing-how-it-works" className="grid gap-8">
      <SectionHeading id="landing-how-title" eyebrow="Cara kerja" title="Tiga langkah dari nol ke dashboard" />
      <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="min-w-0 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground"
            >
              {index + 1}
            </span>
            <h3 className="mt-4 text-base font-semibold tracking-tight">{step.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
