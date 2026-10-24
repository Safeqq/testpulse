/**
 * Pemberitahuan singkat (hasil aksi). Wadah `role="status"` selalu ada agar pembaca layar mengumumkan isi yang muncul belakangan;
 * tampil di sudut layar tanpa menutupi kontrol di bawahnya (hanya tombol Tutup yang menerima klik).
 */
export function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  return (
    <div role="status" className="toast-region" data-testid={message ? "toast" : undefined}>
      {message ? (
        <div className="toast">
          <span>{message}</span>
          <button type="button" className="toast-dismiss" onClick={onDismiss}>
            Tutup
          </button>
        </div>
      ) : null}
    </div>
  );
}
