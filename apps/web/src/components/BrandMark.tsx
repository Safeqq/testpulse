import { cn } from "@/lib/utils";

/** Logo TestPulse: kotak beraksen dengan garis denyut. Dekoratif (teks merek ada di sebelahnya). */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M4 17h6l3-8 5 15 3-7h7"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
