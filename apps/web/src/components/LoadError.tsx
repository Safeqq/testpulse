import { ApiError } from "../lib/api";

/** Kegagalan memuat data: pesan dari server bila ada, plus tombol coba lagi. */
export function LoadError({ error, fallback, onRetry }: { error: unknown; fallback: string; onRetry: () => void }) {
  return (
    <div role="alert" className="form-error">
      <p className="alert-text">{error instanceof ApiError ? error.message : fallback}</p>
      <button type="button" className="button button-secondary" onClick={onRetry}>
        Coba lagi
      </button>
    </div>
  );
}
