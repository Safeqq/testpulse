import { ApiError } from "../lib/api";
import { Button } from "@/components/ui/button";

/** Kegagalan memuat data: pesan dari server bila ada, plus tombol coba lagi. */
export function LoadError({ error, fallback, onRetry }: { error: unknown; fallback: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="grid justify-items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
    >
      <p>{error instanceof ApiError ? error.message : fallback}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Coba lagi
      </Button>
    </div>
  );
}
