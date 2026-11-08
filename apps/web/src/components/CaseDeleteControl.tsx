import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { FormError } from "@/components/FormError";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/forms";

interface CaseDeleteControlProps {
  code: string;
  /** Menghapus case; setelah berhasil induk membawa pengguna kembali ke daftar. Galatnya ditampilkan di sini. */
  onDelete: () => Promise<void>;
}

/** Hapus permanen case (admin) dengan konfirmasi inline; sengaja bukan dialog (komponen dialog tidak diizinkan). */
export function CaseDeleteControl({ code, onDelete }: CaseDeleteControlProps) {
  const questionId = useId();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // Fokus mengikuti langkah: ke "Batal" (aksi aman) saat konfirmasi muncul, kembali ke "Hapus permanen" saat dibatalkan.
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
      setError(errorMessage(err, "Gagal menghapus case. Coba lagi."));
      setPending(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-3">
      {confirming ? (
        <div role="group" aria-labelledby={questionId} className="grid gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <p id={questionId} className="m-0 text-sm font-medium">
            Hapus {code} secara permanen? Tindakan ini tidak dapat dibatalkan. Run manual lama tetap tersimpan utuh (judul dan
            langkahnya disalin saat run dibuat), tetapi tautannya ke case ini hilang. Untuk menyembunyikan case tanpa menghapusnya,
            gunakan Arsipkan.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={pending} data-testid="case-delete-confirm">
              {pending ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              Ya, hapus case
            </Button>
            <Button
              ref={cancelRef}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={pending}
              data-testid="case-delete-cancel"
            >
              Batal
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button ref={deleteRef} type="button" variant="outline" size="sm" onClick={() => setConfirming(true)} data-testid="case-delete">
            <Trash2 aria-hidden="true" />
            Hapus permanen
          </Button>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}
