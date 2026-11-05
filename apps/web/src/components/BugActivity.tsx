import { commentBody, type BugEventDto } from "@testpulse/shared";
import { Loader2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { BugComment } from "@/components/BugComment";
import { LoadError } from "@/components/LoadError";
import { MarkdownEditor, type EditorMode } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { describeEvent } from "@/lib/bugActivity";
import { errorMessage, focusField } from "@/lib/forms";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import type { BugActivity as ActivityModel } from "@/lib/useBugActivity";

interface BugActivityProps {
  slug: string;
  number: number;
  activity: ActivityModel;
  /** Id pengguna yang masuk (null bila anonim), untuk menentukan komentar mana yang boleh diubah. */
  userId: string | null;
  canWrite: boolean;
  isAdmin: boolean;
}

/** Linimasa aktivitas bug (komentar dan perubahan, lama → baru) beserta kotak komentar untuk tester/admin. */
export function BugActivity({ slug, number, activity, userId, canWrite, isAdmin }: BugActivityProps) {
  const { state } = activity;
  // Daerah live untuk pembaca layar: hasil aksi komentar yang tidak punya fokus sendiri ("Komentar dihapus", dst.).
  const [announcement, setAnnouncement] = useState("");
  return (
    <section aria-labelledby="bug-activity-title" className="grid min-w-0 gap-4">
      <h2 id="bug-activity-title" className="text-lg font-semibold tracking-tight">
        Aktivitas
      </h2>
      <p role="status" aria-live="polite" className="sr-only" data-testid="bug-activity-live">
        {announcement}
      </p>
      {state.status === "loading" ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          Memuat aktivitas…
        </p>
      ) : state.status === "error" ? (
        <LoadError error={state.error} fallback="Gagal memuat aktivitas. Coba lagi." onRetry={activity.retry} />
      ) : (
        <>
          {activity.refreshError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive"
              data-testid="bug-activity-refresh-error"
            >
              <span className="min-w-0 flex-1">
                {errorMessage(activity.refreshError, "Gagal memuat aktivitas terbaru.")} Perubahan terbaru mungkin belum tampil.
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => void activity.refresh()} data-testid="bug-activity-refresh-retry">
                Coba lagi
              </Button>
            </div>
          ) : null}
          <div className="min-w-0" data-testid="bug-activity">
            {state.items.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground" data-testid="bug-activity-empty">
                Belum ada aktivitas.
              </p>
            ) : (
              <ol className="m-0 grid list-none gap-3 p-0">
                {state.items.map((item) => (
                  <li key={`${item.kind}:${item.id}`} className="min-w-0">
                    {item.kind === "event" ? (
                      <EventLine event={item} />
                    ) : (
                      <BugComment
                        slug={slug}
                        number={number}
                        comment={item}
                        canEdit={canWrite && item.author.id === userId && item.deletedAt === null}
                        canDelete={canWrite && (item.author.id === userId || isAdmin) && item.deletedAt === null}
                        onChanged={(comment) => activity.replaceComment(comment)}
                        onAnnounce={setAnnouncement}
                        onGone={() => void activity.refresh()}
                      />
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
          {state.nextCursor !== null ? (
            <div className="grid justify-items-start gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={activity.loadingMore}
                data-testid="bug-activity-more"
                onClick={() => void activity.loadMore()}
              >
                {activity.loadingMore ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
                Muat lagi
              </Button>
              {activity.moreError ? (
                <p role="alert" className="m-0 text-sm font-medium text-destructive">
                  {errorMessage(activity.moreError, "Gagal memuat aktivitas berikutnya. Coba lagi.")}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {canWrite ? (
        <CommentForm slug={slug} number={number} onPosted={() => activity.refresh()} onAnnounce={setAnnouncement} />
      ) : null}
    </section>
  );
}

function EventLine({ event }: { event: BugEventDto & { kind: "event" } }) {
  return (
    <p
      className="m-0 min-w-0 border-l-2 pl-3 text-sm text-muted-foreground [overflow-wrap:anywhere]"
      data-testid={`event-${event.id}`}
    >
      <strong className="font-semibold text-foreground">{event.actor.name}</strong> {describeEvent(event)} ·{" "}
      <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>
        {formatRelativeTime(event.createdAt)}
      </time>
    </p>
  );
}

function CommentForm({
  slug,
  number,
  onPosted,
  onAnnounce,
}: {
  slug: string;
  number: number;
  onPosted: () => Promise<void>;
  onAnnounce: (message: string) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<EditorMode>("write");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function fail(fields: Record<string, string>) {
    setFieldError(fields.comment);
    // Kolom teks tersembunyi saat Pratinjau: kembali ke Tulis (sinkron) sebelum memindahkan fokus.
    flushSync(() => setMode("write"));
    focusField(form.current, fields);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const parsed = commentBody.safeParse({ body });
    if (!parsed.success) return fail({ comment: parsed.error.issues[0]?.message ?? "Komentar tidak valid" });
    setPending(true);
    setFieldError(undefined);
    setError(null);
    try {
      await api.comments.create(slug, number, parsed.data);
      setBody("");
      setMode("write");
      onAnnounce("Komentar terkirim");
      await onPosted();
    } catch (err) {
      const message = errorMessage(err, "Gagal mengirim komentar. Coba lagi.");
      if (err instanceof ApiError && err.fields?.body) fail({ comment: err.fields.body });
      else setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={form} onSubmit={submit} noValidate className="grid min-w-0 gap-3" aria-label="Tulis komentar">
      <MarkdownEditor
        name="comment"
        label="Komentar"
        value={body}
        onChange={setBody}
        error={fieldError}
        mode={mode}
        onModeChange={setMode}
        hint="Mendukung Markdown."
        testId="comment-input"
        rows={4}
      />
      {error ? (
        <p role="alert" className="m-0 text-sm font-medium text-destructive" data-testid="comment-error">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending} data-testid="comment-submit">
          {pending ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : null}
          Kirim komentar
        </Button>
      </div>
    </form>
  );
}
