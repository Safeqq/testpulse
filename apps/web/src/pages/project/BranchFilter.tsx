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

/** Pemilih branch native. Branch dari URL yang tak lagi ada di daftar tetap ditampilkan agar pilihan tidak diam-diam berubah. */
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
