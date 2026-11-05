import { commentBody, type CommentDto } from "@testpulse/shared";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { LazyMarkdown } from "@/components/LazyMarkdown";
import { MarkdownEditor, type EditorMode } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/forms";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

interface BugCommentProps {
  slug: string;
  number: number;
  comment: CommentDto;
  /** Penulis (selama tester/admin) boleh mengubah; penulis atau admin boleh menghapus. */
  canEdit: boolean;
  canDelete: boolean;
  onChanged: (comment: CommentDto) => void;
  /** Pengumuman singkat untuk pembaca layar (daerah live di linimasa), mis. "Komentar dihapus". */
  onAnnounce: (message: string) => void;
  /** Komentar sudah tidak ada di server (mis. dihapus orang lain): linimasa dimuat ulang. */
  onGone: () => void;
}

/** Satu komentar di linimasa: Markdown aman, penanda "diedit", edit inline, dan hapus dengan konfirmasi inline. */
export function BugComment({ slug, number, comment, canEdit, canDelete, onChanged, onAnnounce, onGone }: BugCommentProps) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [draft, setDraft] = useState("");
  const [editorMode, setEditorMode] = useState<EditorMode>("write");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const article = useRef<HTMLElement>(null);
  const previous = useRef(mode);

  // Fokus mengikuti langkah: ke kolom saat edit, ke "Batal" (aksi aman) saat konfirmasi hapus, dan kembali ke pemicunya.
  useEffect(() => {
    if (mode === "edit") form.current?.querySelector("textarea")?.focus();
    else if (mode === "confirm-delete") cancelDelete.current?.focus();
    else if (previous.current === "edit") editButton.current?.focus();
    // Komentar yang baru dihapus tidak punya tombol lagi: fokus ke komentarnya sendiri agar tidak jatuh ke awal halaman.
    else if (previous.current === "confirm-delete") (deleteButton.current ?? article.current)?.focus();
    previous.current = mode;
  }, [mode]);

  function startEdit() {
    setDraft(comment.body ?? "");
    setEditorMode("write");
    setFieldError(undefined);
    setError(null);
    setMode("edit");
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const parsed = commentBody.safeParse({ body: draft });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Komentar tidak valid");
      flushSync(() => setEditorMode("write"));
      form.current?.querySelector("textarea")?.focus();
      return;
    }
    setPending(true);
    setFieldError(undefined);
    setError(null);
    try {
      onChanged(await api.comments.update(slug, number, comment.id, parsed.data));
      onAnnounce("Komentar diubah");
      setMode("view");
    } catch (err) {
      if (err instanceof ApiError && err.code === "COMMENT_NOT_FOUND") return onGone();
      setError(errorMessage(err, "Gagal menyimpan komentar. Coba lagi."));
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await api.comments.remove(slug, number, comment.id);
      onChanged({ ...comment, body: null, deletedAt: new Date().toISOString() });
      onAnnounce("Komentar dihapus");
      setMode("view");
    } catch (err) {
      if (err instanceof ApiError && err.code === "COMMENT_NOT_FOUND") return onGone();
      setError(errorMessage(err, "Gagal menghapus komentar. Coba lagi."));
    } finally {
      setPending(false);
    }
  }

  const deleted = comment.deletedAt !== null;
  const headerId = `comment-header-${comment.id}`;
  return (
    <article
      ref={article}
      tabIndex={-1}
      aria-labelledby={headerId}
      className="grid min-w-0 gap-2 rounded-lg border bg-card px-4 py-3 outline-hidden"
      data-testid={`comment-${comment.id}`}
    >
      <header id={headerId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
        <strong className="min-w-0 font-semibold [overflow-wrap:anywhere]">{comment.author.name}</strong>
        <span className="text-muted-foreground">
          <time dateTime={comment.createdAt} title={formatDateTime(comment.createdAt)}>
            {formatRelativeTime(comment.createdAt)}
          </time>
          {comment.editedAt && !deleted ? (
            <>
              {" · "}
              <span title={formatDateTime(comment.editedAt)}>diedit</span>
            </>
          ) : null}
        </span>
      </header>

      {deleted ? (
        <p className="m-0 text-sm text-muted-foreground italic">Komentar dihapus</p>
      ) : mode === "edit" ? (
        <form ref={form} onSubmit={saveEdit} noValidate className="grid min-w-0 gap-3">
          <MarkdownEditor
            name={`comment-edit-${comment.id}`}
            label="Ubah komentar"
            value={draft}
            onChange={setDraft}
            error={fieldError}
            mode={editorMode}
            onModeChange={setEditorMode}
            testId={`comment-edit-input-${comment.id}`}
            rows={4}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending} data-testid={`comment-edit-save-${comment.id}`}>
              {pending ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              Simpan
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              data-testid={`comment-edit-cancel-${comment.id}`}
              onClick={() => setMode("view")}
            >
              Batal
            </Button>
          </div>
        </form>
      ) : (
        <div className="min-w-0">
          <LazyMarkdown source={comment.body ?? ""} />
        </div>
      )}

      {error ? (
        <p role="alert" className="m-0 text-sm font-medium text-destructive" data-testid={`comment-error-${comment.id}`}>
          {error}
        </p>
      ) : null}

      {!deleted && mode === "view" && (canEdit || canDelete) ? (
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <Button
              ref={editButton}
              type="button"
              size="sm"
              variant="outline"
              aria-label="Ubah komentar"
              aria-describedby={headerId}
              data-testid={`comment-edit-${comment.id}`}
              onClick={startEdit}
            >
              <Pencil aria-hidden="true" />
              Ubah
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              ref={deleteButton}
              type="button"
              size="sm"
              variant="outline"
              aria-label="Hapus komentar"
              aria-describedby={headerId}
              data-testid={`comment-delete-${comment.id}`}
              onClick={() => setMode("confirm-delete")}
            >
              <Trash2 aria-hidden="true" />
              Hapus
            </Button>
          ) : null}
        </div>
      ) : null}

      {mode === "confirm-delete" ? (
        <div role="group" aria-label="Konfirmasi hapus komentar" className="grid gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <p className="m-0 text-sm font-medium">Hapus komentar ini? Isinya akan dikosongkan dan tidak dapat dikembalikan.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={pending}
              data-testid={`comment-delete-confirm-${comment.id}`}
              onClick={remove}
            >
              {pending ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              Ya, hapus komentar
            </Button>
            <Button
              ref={cancelDelete}
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              data-testid={`comment-delete-cancel-${comment.id}`}
              onClick={() => setMode("view")}
            >
              Batal
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
