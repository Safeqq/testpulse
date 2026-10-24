import { useCallback, useEffect, useState } from "react";

export type LoadState<T> = { state: "loading" } | { state: "error"; error: unknown } | { state: "ready"; data: T };

type Outcome<T> = { ok: true; data: T } | { ok: false; error: unknown };

interface Settled<T> {
  source: () => Promise<T>;
  attempt: number;
  outcome: Outcome<T>;
}

/**
 * Memuat data saat `fetcher` berubah (harus stabil, mis. `useCallback`) atau saat `reload()` dipanggil.
 * Status "loading" diturunkan dari hasil yang sudah selesai, bukan di-set di dalam effect.
 */
export function useLoad<T>(fetcher: () => Promise<T>): LoadState<T> & { reload: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    let active = true;
    fetcher().then(
      (data) => {
        if (active) setSettled({ source: fetcher, attempt, outcome: { ok: true, data } });
      },
      (error: unknown) => {
        if (active) setSettled({ source: fetcher, attempt, outcome: { ok: false, error } });
      },
    );
    return () => {
      active = false;
    };
  }, [fetcher, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  if (!settled || settled.source !== fetcher || settled.attempt !== attempt) return { state: "loading", reload };
  return settled.outcome.ok
    ? { state: "ready", data: settled.outcome.data, reload }
    : { state: "error", error: settled.outcome.error, reload };
}
