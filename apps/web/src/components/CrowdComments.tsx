import { crowdCommentBody, type CrowdCommentDto, type CrowdCommentsPageDto } from "@testpulse/shared";
import { Loader2, Trash2 } from "lucide-react";
import { useCallback, useId, useState, type FormEvent } from "react";
import { LazyMarkdown } from "@/components/LazyMarkdown";
import { LoadError } from "@/components/LoadError";
import { Loading } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/forms";
import { formatRelativeTime } from "@/lib/format";
import { useCursorList } from "@/lib/useCursorList";

interface CrowdCommentsProps {
  load: (cursor?: string) => Promise<CrowdCommentsPageDto>;
  add: (body: string) => Promise<CrowdCommentDto>;
  remove: (id: string) => Promise<void>;
  /** Pengguna yang login (hanya penulis yang bisa menghapus komentarnya). */
  currentUserId: string | null;
  canWrite: boolean;
}

/**
 * Thread komentar laporan crowd (spec Tahap 5 §5.6): satu thread untuk pelapor dan tim, Markdown aman, tanpa edit,
 * hapus hanya milik sendiri (soft delete).
 */
export function CrowdComments({ load, add, remove, currentUserId, canWrite }: CrowdCommentsProps) {
  const inputId = useId();
  const [reloadKey, setReloadKey] = useState(0);
  const fetchPage = useCallback(
    async (cursor?: string) => {
      void reloadKey;
      const page = await load(cursor);
      return { items: page.items, nextCursor: page.nextCursor };
    },
    [load, reloadKey],
  );
  const list = useCursorList(fetchPage);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = crowdCommentBody.safeParse({ body: draft });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Komentar tidak valid");
    setBusy(true);
    setError(null);
    try {
      await add(parsed.data.body);
      setDraft("");
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(errorMessage(err, "Gagal mengirim komentar. Coba lagi."));
    } finally {
      setBusy(false);
    }
  }

  async function deleteComment(id: string) {
    setError(null);
    try {
      await remove(id);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(errorMessage(err, "Gagal menghapus komentar. Coba lagi."));
    }
  }

  return (
    <section aria-labelledby={`${inputId}-title`} className="grid min-w-0 gap-3" data-testid="crowd-comments">
      <h2 id={`${inputId}-title`} className="text-lg font-semibold">
        Komentar
      </h2>
      {list.state === "loading" ? <Loading label="Memuat komentar…" /> : null}
      {list.state === "error" ? <LoadError error={list.error} fallback="Gagal memuat komentar. Coba lagi." onRetry={list.reload} /> : null}
      {list.state === "ready" ? (
        list.items.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">Belum ada komentar.</p>
        ) : (
          <ol className="m-0 grid list-none gap-3 p-0">
            {list.items.map((comment) => (
              <li key={comment.id} className="grid min-w-0 gap-1 rounded-lg border bg-card px-4 py-3" data-testid={`crowd-comment-${comment.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium [overflow-wrap:anywhere]">{comment.author.name}</span>
                  <span className="text-muted-foreground">{formatRelativeTime(comment.createdAt)}</span>
                </div>
                {comment.body === null ? (
                  <p className="m-0 text-sm text-muted-foreground italic">Komentar dihapus</p>
                ) : (
                  <LazyMarkdown source={comment.body} />
                )}
                {comment.body !== null && comment.author.id === currentUserId ? (
                  <div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void deleteComment(comment.id)} data-testid={`crowd-comment-delete-${comment.id}`}>
                      <Trash2 aria-hidden="true" />
                      Hapus
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )
      ) : null}
      {list.state === "ready" && list.hasMore ? (
        <div>
          <Button type="button" variant="outline" onClick={list.loadMore} disabled={list.loadingMore}>
            Muat lagi
          </Button>
        </div>
      ) : null}
      {canWrite ? (
        <form onSubmit={submit} className="grid min-w-0 gap-2">
          <label htmlFor={inputId} className="text-sm font-medium">
            Tulis komentar
          </label>
          <textarea
            id={inputId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={5000}
            className="w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-hidden"
            data-testid="crowd-comment-input"
          />
          <div>
            <Button type="submit" disabled={busy} data-testid="crowd-comment-submit">
              {busy ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
              Kirim komentar
            </Button>
          </div>
        </form>
      ) : null}
      <p role="alert" className={error ? "m-0 text-sm font-medium text-destructive" : "sr-only"}>
        {error}
      </p>
    </section>
  );
}
