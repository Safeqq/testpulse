import { Search } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SearchFormProps {
  value: string;
  onSubmit: (value: string) => void;
  /** testid kolom; tombolnya `<testId>-submit`. */
  testId: string;
}

/** Kolom cari judul: teks diketik lokal, dikirim ke URL saat submit, dan mengikuti URL bila berubah dari luar (mis. Kembali/Atur ulang). */
export function SearchForm({ value, onSubmit, testId }: SearchFormProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  // Menyelaraskan state saat render (tanpa effect/remount) supaya kolom tetap fokus setelah submit.
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <form
      role="search"
      className="flex min-w-0 flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-md">
        <Label htmlFor={id}>Cari judul</Label>
        <Input
          id={id}
          name="q"
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={100}
          autoComplete="off"
          data-testid={testId}
        />
      </div>
      <Button type="submit" variant="outline" data-testid={`${testId}-submit`}>
        <Search aria-hidden="true" />
        Cari
      </Button>
    </form>
  );
}
