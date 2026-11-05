import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FormError } from "@/components/FormError";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/forms";

interface BugDeleteControlProps {
  number: number;
  /** Menghapus bug; setelah berhasil induk membawa pengguna kembali ke daftar. Galatnya ditampilkan di sini. */
  onDelete: () => Promise<void>;
}

/** Hapus bug (admin) dengan langkah konfirmasi inline; sengaja bukan dialog (komponen dialog tidak diizinkan). */
export function BugDeleteControl({ number, onDelete }: BugDeleteControlProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // Fokus berpindah mengikuti langkah: ke "Batal" (aksi aman) saat konfirmasi muncul, kembali ke "Hapus bug" saat dibatalkan.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) deleteRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      setError(errorMessage(err, "Gagal menghapus bug. Coba lagi."));
      setPending(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-3">
      {confirming ? (
        <div role="group" aria-labelledby="delete-bug-question" className="grid gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <p id="delete-bug-question" className="m-0 text-sm font-medium">
            Hapus bug #{number} beserta komentar dan riwayatnya? Tindakan ini tidak dapat dibatalkan.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={pending} data-testid="bug-delete-confirm">
              {pending ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              Ya, hapus bug
            </Button>
            <Button
              ref={cancelRef}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={pending}
              data-testid="bug-delete-cancel"
            >
              Batal
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button ref={deleteRef} type="button" variant="outline" size="sm" onClick={() => setConfirming(true)} data-testid="bug-delete">
            <Trash2 aria-hidden="true" />
            Hapus bug
          </Button>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}
