import { BUG_PRIORITIES, BUG_SEVERITIES, type BugDto, type MemberDto } from "@testpulse/shared";
import { useId, useState } from "react";
import { NativeSelect } from "@/components/NativeSelect";
import { Label } from "@/components/ui/label";
import { BUG_PRIORITY_LABEL, BUG_SEVERITY_LABEL } from "@/lib/bugs";
import type { BugPatch } from "@/lib/bugForm";
import type { SaveResult } from "@/lib/bugSave";

interface BugFieldsProps {
  bug: Pick<BugDto, "assignee" | "priority" | "severity">;
  /** Anggota project untuk pilihan assignee; kosong sampai dimuat (assignee sekarang selalu ada di pilihan). */
  members: MemberDto[];
  canEdit: boolean;
  onSave: (patch: BugPatch) => Promise<SaveResult>;
}

/** Assignee, prioritas, dan severity: pilihan native yang langsung menyimpan untuk tester/admin, teks biasa untuk lainnya. */
export function BugFields({ bug, members, canEdit, onSave }: BugFieldsProps) {
  const assignee = bug.assignee;
  const options = [
    { value: "", label: "Belum di-assign" },
    ...members.map((member) => ({ value: member.userId, label: member.name })),
    // Assignee yang sudah bukan anggota tidak mungkin (server mengosongkannya), tetapi pilihan tidak boleh hilang saat daftar dimuat.
    ...(assignee && !members.some((member) => member.userId === assignee.id) ? [{ value: assignee.id, label: assignee.name }] : []),
  ];
  return (
    <dl className="m-0 grid min-w-0 gap-3 text-sm">
      <Field
        label="Assignee"
        testId="bug-assignee"
        value={assignee?.id ?? ""}
        options={options}
        canEdit={canEdit}
        onChange={(value) => onSave({ assigneeId: value === "" ? null : value })}
      />
      <Field
        label="Prioritas"
        testId="bug-priority"
        value={bug.priority}
        options={BUG_PRIORITIES.map((value) => ({ value, label: BUG_PRIORITY_LABEL[value] }))}
        canEdit={canEdit}
        onChange={(value) => onSave({ priority: value as BugDto["priority"] })}
      />
      <Field
        label="Severity"
        testId="bug-severity"
        value={bug.severity}
        options={BUG_SEVERITIES.map((value) => ({ value, label: BUG_SEVERITY_LABEL[value] }))}
        canEdit={canEdit}
        onChange={(value) => onSave({ severity: value as BugDto["severity"] })}
      />
    </dl>
  );
}

interface FieldProps {
  label: string;
  testId: string;
  value: string;
  options: { value: string; label: string }[];
  canEdit: boolean;
  onChange: (value: string) => Promise<SaveResult>;
}

function Field({ label, testId, value, options, canEdit, onChange }: FieldProps) {
  const id = useId();
  // Nilai yang baru dipilih tampil segera; setelah simpan selesai nilai kembali mengikuti bug (berhasil atau ditolak).
  const [pending, setPending] = useState<string | null>(null);

  if (!canEdit) {
    return (
      <div className="grid min-w-0 gap-0.5">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="m-0 min-w-0 font-medium [overflow-wrap:anywhere]" data-testid={testId}>
          {options.find((option) => option.value === value)?.label ?? value}
        </dd>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-1.5 [&>dd>span]:w-full">
      <dt>
        <Label htmlFor={id}>{label}</Label>
      </dt>
      <dd className="m-0 min-w-0">
        <NativeSelect
          id={id}
          value={pending ?? value}
          data-testid={testId}
          className="w-full"
          onChange={async (event) => {
            setPending(event.target.value);
            try {
              await onChange(event.target.value);
            } finally {
              setPending(null);
            }
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </dd>
    </div>
  );
}
