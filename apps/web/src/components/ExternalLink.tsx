import { ExternalLink as ExternalIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Nama domain dari URL http(s) untuk ditampilkan; `null` bila URL tidak bisa diurai. */
function domainOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Tautan ke situs luar (aplikasi yang diuji, bukti laporan): label, domain, dan keterangan bahwa tautan membuka situs
 * luar. Selalu tab baru dengan `rel="noopener noreferrer"` (spec Tahap 5 §9.2).
 */
export function ExternalLink({
  href,
  label,
  className,
  ...props
}: {
  href: string;
  label: string;
  className?: string;
  "data-testid"?: string;
}) {
  const domain = domainOf(href);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-hidden",
        className,
      )}
      {...props}
    >
      <span className="inline-flex min-w-0 items-center gap-1 [overflow-wrap:anywhere]">
        {label}
        <ExternalIcon className="size-3.5 shrink-0" aria-hidden="true" />
      </span>
      {domain ? <span className="min-w-0 text-xs font-normal text-muted-foreground [overflow-wrap:anywhere]">{domain}</span> : null}
      <span className="sr-only">(membuka situs luar di tab baru)</span>
    </a>
  );
}
