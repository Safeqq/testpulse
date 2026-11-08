import { useId, type ReactNode } from "react";
import { NativeSelect } from "@/components/NativeSelect";
import { Label } from "@/components/ui/label";

interface FilterSelectProps {
  label: string;
  testId: string;
  /** Opsi pertama (nilai kosong) yang berarti "tanpa filter". */
  allLabel: string;
  value: string;
  options: [string, ReactNode][];
  onChange: (value: string) => void;
}

/** Filter daftar berupa `<select>` native berlabel, satu-satunya markup untuk filter daftar bug dan daftar test case. */
export function FilterSelect({ label, testId, allLabel, value, options, onChange }: FilterSelectProps) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1.5 [&>span]:w-full">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} className="w-full">
        <option value="">{allLabel}</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
