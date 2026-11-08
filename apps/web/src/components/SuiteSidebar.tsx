import { suiteBody, type SuiteDto } from "@testpulse/shared";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { validate } from "@/lib/forms";
import { cn } from "@/lib/utils";

/**
 * Pesan untuk satu aksi suite. Kesalahan field `name` dari server (nama kembar, batas 200 suite) lebih spesifik daripada
 * pesan umum "data tidak valid"; kode lain (mis. SUITE_NOT_EMPTY) sudah membawa pesan Indonesia yang siap tampil.
 */
function suiteErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.fields?.name ?? err.message;
  return "Terjadi kesalahan. Coba lagi.";
}

type RunAction = (action: () => Promise<unknown>) => Promise<string | null>;

interface SuiteControlsProps {
  slug: string;
  suites: SuiteDto[];
  /** Id suite terpilih; kosong = Semua suite. */
  selected: string;
  canWrite: boolean;
  canDelete: boolean;
  /** Memuat ulang daftar suite setelah sebuah aksi (berhasil atau tidak); selesai saat daftar baru terpasang. */
  onChanged: () => Promise<void>;
  /** Suite berhasil dihapus; halaman melepas pilihan bila itu suite yang sedang dipilih. */
  onRemoved: (id: string) => void;
}

/**
 * Menjalankan satu aksi suite pada satu waktu (`busy`), agar dua pindah urutan beruntun tidak saling menimpa posisi.
 * Aksi dijalankan lalu daftar dimuat ulang; hasilnya pesan error (atau `null`) untuk ditampilkan pemanggil.
 */
function useSuiteActions(onChanged: () => Promise<void>): {
  busy: boolean;
  run: RunAction;
} {
  const [busy, setBusy] = useState(false);
  const run: RunAction = async (action) => {
    setBusy(true);
    try {
      await action();
      return null;
    } catch (err) {
      return suiteErrorMessage(err);
    } finally {
      // Dimuat ulang juga saat gagal: suite bisa sudah diubah atau dihapus orang lain.
      await onChanged();
      setBusy(false);
    }
  };
  return { busy, run };
}

interface SuiteSidebarProps extends SuiteControlsProps {
  onSelect: (id: string) => void;
}

/**
 * Sidebar suite untuk layar lebar (spec Tahap 4 §8.2): "Semua suite" dan tiap suite dengan jumlah case aktif. Tester+
 * menambah suite, mengganti nama, dan memindah urutan (▲/▼); admin menghapus suite kosong dengan konfirmasi inline.
 * Di HP halaman memakai `SuiteMobileControls` bersama `suite-select`; hanya salah satunya yang dirender (id uji unik).
 */
export function SuiteSidebar({
  slug,
  suites,
  selected,
  onSelect,
  canWrite,
  canDelete,
  onChanged,
  onRemoved,
}: SuiteSidebarProps) {
  const headingId = useId();
  const { busy, run } = useSuiteActions(onChanged);
  const total = suites.reduce((sum, suite) => sum + suite.activeCount, 0);

  return (
    <section aria-labelledby={headingId} className="grid min-w-0 content-start gap-3">
      <h2 id={headingId} className="text-sm font-semibold">
        Suite
      </h2>
      <ul data-testid="suite-list" className="m-0 grid list-none gap-1 p-0">
        <li>
          <SuiteButton
            testId="suite-all"
            name="Semua suite"
            count={total}
            pressed={selected === ""}
            onClick={() => onSelect("")}
          />
        </li>
        {suites.map((suite, index) => (
          <SuiteItem
            key={suite.id}
            slug={slug}
            suite={suite}
            isFirst={index === 0}
            isLast={index === suites.length - 1}
            pressed={selected === suite.id}
            onSelect={onSelect}
            canWrite={canWrite}
            canDelete={canDelete}
            busy={busy}
            run={run}
            onRemoved={onRemoved}
          />
        ))}
      </ul>
      {canWrite ? <AddSuiteForm slug={slug} busy={busy} run={run} /> : null}
    </section>
  );
}

/**
 * Pengelolaan suite di HP (spec §8.2), dilipat dalam `<details>` agar daftar case tetap dekat di layar kecil: menambah suite, dan untuk suite yang sedang dipilih di `suite-select` mengganti
 * nama, memindah (▲/▼), atau menghapusnya. Memakai `SuiteItem` dan `AddSuiteForm` yang sama dengan sidebar, jadi aksi,
 * label aksesibel, dan pesan error identik. Tanpa hak tulis tidak ada yang dirender.
 */
export function SuiteMobileControls({
  slug,
  suites,
  selected,
  canWrite,
  canDelete,
  onChanged,
  onRemoved,
}: SuiteControlsProps) {
  const { busy, run } = useSuiteActions(onChanged);
  if (!canWrite) return null;
  const index = suites.findIndex((suite) => suite.id === selected);
  const suite = suites[index];
  return (
    <details data-testid="suite-manage-panel" className="group min-w-0 rounded-md border bg-card">
      <summary
        data-testid="suite-manage-toggle"
        className="cursor-pointer rounded-md px-3 py-2 text-sm font-medium outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        Kelola suite
      </summary>
      <div className="grid min-w-0 gap-3 border-t p-3">
        {suite ? (
          <ul data-testid="suite-manage" className="m-0 grid list-none p-0">
            <SuiteItem
              // key: pindah suite di suite-select harus membuang state lokal (kolom ganti nama, konfirmasi hapus, error) suite lama.
              key={suite.id}
              slug={slug}
              suite={suite}
              isFirst={index === 0}
              isLast={index === suites.length - 1}
              pressed
              showSelect={false}
              canWrite
              canDelete={canDelete}
              busy={busy}
              run={run}
              onRemoved={onRemoved}
            />
          </ul>
        ) : (
          <p className="m-0 text-sm text-muted-foreground">
            Pilih satu suite di atas untuk mengganti nama, memindahkan, atau menghapusnya.
          </p>
        )}
        <AddSuiteForm slug={slug} busy={busy} run={run} />
      </div>
    </details>
  );
}

function SuiteButton({
  testId,
  name,
  count,
  pressed,
  onClick,
}: {
  testId: string;
  name: string;
  count: number;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "flex w-full min-w-0 items-baseline justify-between gap-2 rounded-md px-3 py-2 text-left text-sm outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring",
        pressed ? "bg-secondary font-medium text-secondary-foreground" : "text-foreground hover:bg-accent",
      )}
    >
      <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
      <span className={cn("shrink-0 text-xs tabular-nums", pressed ? "" : "text-muted-foreground")}>{count}</span>
    </button>
  );
}

function IconAction({
  testId,
  label,
  disabled,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={label}
      title={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

type Mode = "view" | "rename" | "delete";

interface SuiteItemProps {
  slug: string;
  suite: SuiteDto;
  isFirst: boolean;
  isLast: boolean;
  pressed: boolean;
  onSelect?: (id: string) => void;
  /** Tampilkan tombol pemilih suite; di HP pilihan ada di `suite-select`, jadi hanya nama suite yang tampil. */
  showSelect?: boolean;
  canWrite: boolean;
  canDelete: boolean;
  busy: boolean;
  run: RunAction;
  onRemoved: (id: string) => void;
}

function SuiteItem({
  slug,
  suite,
  isFirst,
  isLast,
  pressed,
  onSelect,
  showSelect = true,
  canWrite,
  canDelete,
  busy,
  run,
  onRemoved,
}: SuiteItemProps) {
  const inputId = useId();
  const errorId = useId();
  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState(suite.name);
  const [error, setError] = useState<string | null>(null);
  const renameTrigger = useRef<HTMLButtonElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  // Tombol pemicu yang harus mendapat fokus lagi setelah kolom ganti nama/konfirmasi hapus ditutup.
  const returnFocusTo = useRef<"rename" | "delete" | null>(null);

  useEffect(() => {
    if (mode !== "view" || returnFocusTo.current === null) return;
    (returnFocusTo.current === "rename" ? renameTrigger : deleteTrigger).current?.focus();
    returnFocusTo.current = null;
  }, [mode]);

  function close(from: "rename" | "delete") {
    returnFocusTo.current = from;
    setMode("view");
  }

  async function move(delta: -1 | 1) {
    // Posisi tujuan 0-based; server membatasi ke rentang yang ada.
    const message = await run(() =>
      api.manual.suites.update(slug, suite.id, {
        position: suite.position + delta,
      }),
    );
    setError(message);
  }

  async function saveRename(event: FormEvent) {
    event.preventDefault();
    const parsed = validate(suiteBody, { name: draft });
    if (!parsed.ok) return setError(parsed.fields.name ?? "Nama suite tidak valid");
    setError(null);
    const message = await run(() => api.manual.suites.update(slug, suite.id, { name: parsed.data.name }));
    if (message) setError(message);
    else close("rename");
  }

  async function confirmDelete() {
    setError(null);
    const message = await run(() => api.manual.suites.remove(slug, suite.id));
    if (message) {
      setError(message);
      close("delete");
    } else onRemoved(suite.id);
  }

  function renameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") return;
    setError(null);
    close("rename");
  }

  return (
    <li data-testid={`suite-item-${suite.id}`} className="grid gap-1">
      {mode === "rename" ? (
        <form onSubmit={saveRename} noValidate className="grid gap-1.5 px-1">
          <Label htmlFor={inputId} className="sr-only">
            Nama baru untuk suite {suite.name}
          </Label>
          <Input
            id={inputId}
            name="name"
            value={draft}
            maxLength={100}
            autoFocus
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            data-testid={`suite-rename-input-${suite.id}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={renameKeyDown}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy} data-testid={`suite-rename-save-${suite.id}`}>
              Simpan
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid={`suite-rename-cancel-${suite.id}`}
              onClick={() => {
                setError(null);
                close("rename");
              }}
            >
              Batal
            </Button>
          </div>
        </form>
      ) : showSelect ? (
        <SuiteButton
          testId={`suite-${suite.id}`}
          name={suite.name}
          count={suite.activeCount}
          pressed={pressed}
          onClick={() => onSelect?.(suite.id)}
        />
      ) : (
        <p className="m-0 px-1 text-sm [overflow-wrap:anywhere]">
          Suite terpilih: <span className="font-medium">{suite.name}</span>
        </p>
      )}

      {mode === "delete" ? (
        <div className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="m-0 font-medium [overflow-wrap:anywhere]">Hapus suite “{suite.name}”?</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              data-testid={`suite-delete-confirm-${suite.id}`}
              onClick={confirmDelete}
            >
              Hapus
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid={`suite-delete-cancel-${suite.id}`}
              onClick={() => close("delete")}
            >
              Batal
            </Button>
          </div>
        </div>
      ) : null}

      {canWrite && mode === "view" ? (
        <div className="flex items-center gap-0.5 px-1">
          <IconAction
            testId={`suite-up-${suite.id}`}
            label={`Pindah ke atas: ${suite.name}`}
            disabled={busy || isFirst}
            onClick={() => void move(-1)}
          >
            <span aria-hidden="true">▲</span>
          </IconAction>
          <IconAction
            testId={`suite-down-${suite.id}`}
            label={`Pindah ke bawah: ${suite.name}`}
            disabled={busy || isLast}
            onClick={() => void move(1)}
          >
            <span aria-hidden="true">▼</span>
          </IconAction>
          <Button
            ref={renameTrigger}
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Ganti nama suite ${suite.name}`}
            title={`Ganti nama suite ${suite.name}`}
            data-testid={`suite-rename-${suite.id}`}
            disabled={busy}
            onClick={() => {
              setDraft(suite.name);
              setError(null);
              setMode("rename");
            }}
          >
            <Pencil aria-hidden="true" />
          </Button>
          {canDelete ? (
            <Button
              ref={deleteTrigger}
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Hapus suite ${suite.name}`}
              title={`Hapus suite ${suite.name}`}
              data-testid={`suite-delete-${suite.id}`}
              disabled={busy}
              onClick={() => {
                setError(null);
                setMode("delete");
              }}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="m-0 px-1 text-sm font-medium text-destructive [overflow-wrap:anywhere]">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function AddSuiteForm({ slug, busy, run }: { slug: string; busy: boolean; run: RunAction }) {
  const id = useId();
  const errorId = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = validate(suiteBody, { name });
    if (!parsed.ok) return setError(parsed.fields.name ?? "Nama suite tidak valid");
    setError(null);
    const message = await run(() => api.manual.suites.create(slug, parsed.data));
    if (message) setError(message);
    else setName("");
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-1.5">
      <Label htmlFor={id}>Suite baru</Label>
      <div className="flex min-w-0 gap-2">
        <Input
          id={id}
          name="name"
          value={name}
          maxLength={100}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          data-testid="suite-add"
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={busy} data-testid="suite-add-submit">
          <Plus aria-hidden="true" />
          Tambah
        </Button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="m-0 text-sm font-medium text-destructive" data-testid="suite-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
