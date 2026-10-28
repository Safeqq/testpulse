import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  /** Berubah (mis. pindah rute) → boundary mencoba merender anaknya lagi. */
  resetKey?: string;
  children: ReactNode;
}

/**
 * Menangkap kegagalan memuat chunk halaman (jaringan putus, deploy baru menghapus berkas lama) agar aplikasi tidak
 * menjadi layar kosong. `React.lazy` menyimpan penolakan impor, jadi satu-satunya pemulihan yang andal adalah memuat ulang.
 */
export class ChunkErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        data-testid="chunk-error"
        className="grid justify-items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
      >
        <p>Halaman gagal dimuat. Periksa koneksi Anda lalu muat ulang.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
          Muat ulang halaman
        </Button>
      </div>
    );
  }
}
