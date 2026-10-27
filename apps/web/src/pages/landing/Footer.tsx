import { BrandMark } from "@/components/BrandMark";

const LINKS = [
  { label: "GitHub", href: "https://github.com/Safeqq/testpulse" },
  { label: "Dokumentasi", href: "https://github.com/Safeqq/testpulse#readme" },
  { label: "Laporan test", href: "https://safeqq.github.io/testpulse/" },
] as const;

export function Footer() {
  return (
    <footer
      data-testid="landing-footer"
      className="flex flex-col gap-4 border-t pt-8 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-2 font-semibold tracking-tight">
        <BrandMark size={22} />
        TestPulse
        <span className="text-sm font-normal text-muted-foreground">© {new Date().getFullYear()}</span>
      </div>
      <nav aria-label="Tautan footer">
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {LINKS.map((link) => (
            <li key={link.label}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm text-link underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
              >
                {link.label}
                <span className="sr-only"> (membuka tab baru)</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
