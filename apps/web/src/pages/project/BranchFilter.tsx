import type { BranchDto } from "@testpulse/shared";
import { NativeSelect } from "@/components/NativeSelect";
import { Label } from "@/components/ui/label";

interface BranchFilterProps {
  id: string;
  testId: string;
  branches: BranchDto[];
  value: string;
  onChange: (branch: string) => void;
  /** Label opsi "semua branch" (nilai kosong); tanpa ini pilihan harus salah satu branch. */
  allLabel?: string;
}

/**
 * Pemilih branch native, satu-satunya markup untuk dashboard, daftar run, dan daftar flaky. Branch dari URL yang tak
 * lagi ada di daftar tetap ditampilkan agar pilihan tidak diam-diam berubah.
 *
 * Catatan CSP/WebKit: WebKit melaporkan style-src-attr palsu untuk <select> (lihat tests/support/csp.ts). Penjaga E2E
 * hanya memaklumi bila target event-nya <select>, yang tidak berlaku untuk select di dalam subtree Suspense yang
 * sedang menunggu. Karena itu di dashboard (ProjectResults) komponen ini dirender DI LUAR Suspense yang membungkus
 * chunk lazy; di halaman lazy (runs, flaky) select baru dibuat setelah chunk selesai dimuat dan lolos di tiga browser.
 */
export function BranchFilter({ id, testId, branches, value, onChange, allLabel }: BranchFilterProps) {
  const known = value === "" || branches.some((b) => b.branch === value);
  return (
    <div className="grid w-full grid-cols-1 gap-1.5 sm:w-72 [&>span]:w-full">
      <Label htmlFor={id}>Branch</Label>
      <NativeSelect id={id} data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} className="w-full">
        {allLabel ? <option value="">{allLabel}</option> : null}
        {known ? null : <option value={value}>{value}</option>}
        {branches.map((b) => (
          <option key={b.branch} value={b.branch}>
            {b.branch}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
