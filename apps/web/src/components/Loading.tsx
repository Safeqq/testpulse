import { Loader2 } from "lucide-react";

/** Penanda memuat yang diumumkan pembaca layar (role="status"). */
export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
      {label}
    </p>
  );
}
