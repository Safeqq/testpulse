import { Button } from "@/components/ui/button";

/**
 * Pemberitahuan singkat (hasil aksi). Wadah `role="status"` selalu ada agar pembaca layar mengumumkan isi yang muncul belakangan;
 * tampil di sudut layar tanpa menutupi kontrol di bawahnya (hanya tombol Tutup yang menerima klik).
 */
export function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="pointer-events-none fixed right-4 bottom-4 z-50 w-[min(24rem,calc(100vw-2rem))]"
      data-testid={message ? "toast" : undefined}
    >
      {message ? (
        <div className="pointer-events-none flex items-center gap-3 rounded-lg bg-foreground py-2.5 pr-2.5 pl-4 text-sm text-background shadow-lg">
          <span className="min-w-0 flex-1">{message}</span>
          <Button type="button" variant="outline" size="sm" className="pointer-events-auto" onClick={onDismiss}>
            Tutup
          </Button>
        </div>
      ) : null}
    </div>
  );
}
