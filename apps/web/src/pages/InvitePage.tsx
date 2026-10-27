import { useCallback, useState } from "react";
import { Loader2, MailX } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { FormError } from "../components/FormError";
import { LoadError } from "../components/LoadError";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage, useDocumentTitle } from "../lib/forms";
import { formatDateTime } from "../lib/format";
import { loginPathFor, registerPathFor } from "../lib/navigation";
import { ROLE_LABEL } from "../lib/roles";
import { useLoad } from "../lib/useLoad";

/** `/invite/:token`: pratinjau terbuka tanpa login; menerima butuh login (anonim diarahkan masuk lalu kembali ke sini). */
export function InvitePage() {
  useDocumentTitle("Undangan project");
  const { token = "" } = useParams();
  const { status } = useAuth();
  const navigate = useNavigate();
  const fetchPreview = useCallback(() => api.invitations.preview(token), [token]);
  const load = useLoad(fetchPreview);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyMember, setAlreadyMember] = useState(false);

  if (load.state === "loading") {
    return (
      <p role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
        Memuat undangan…
      </p>
    );
  }

  if (load.state === "error") {
    // 404 (tidak ada/dicabut) dan 410 (dipakai/kedaluwarsa) tidak akan membaik dengan mencoba lagi.
    if (load.error instanceof ApiError && (load.error.status === 404 || load.error.status === 410)) {
      return (
        <section className="mx-auto w-full max-w-lg py-4 md:py-10">
          <EmptyState
            icon={MailX}
            title="Undangan tidak dapat dipakai"
            headingLevel="h1"
            data-testid="invite-error"
            action={
              <Button asChild variant="outline">
                <Link to="/">Ke beranda</Link>
              </Button>
            }
          >
            <p>{load.error.message}</p>
          </EmptyState>
        </section>
      );
    }
    return <LoadError error={load.error} fallback="Gagal memuat undangan. Coba lagi." onRetry={load.reload} />;
  }

  const invitation = load.data;
  const invitePath = `/invite/${token}`;

  async function accept() {
    if (accepting) return;
    setError(null);
    setAlreadyMember(false);
    setAccepting(true);
    try {
      const result = await api.invitations.accept(token);
      navigate(`/p/${result.projectSlug}`);
    } catch (err) {
      setError(errorMessage(err, "Gagal menerima undangan. Coba lagi."));
      setAlreadyMember(err instanceof ApiError && err.code === "ALREADY_MEMBER");
      setAccepting(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-md py-4 md:py-10" aria-labelledby="invite-title">
      <Card>
        <CardHeader className="items-center text-center">
          <BrandMark size={40} />
          <h1 id="invite-title" className="mt-2 text-2xl font-semibold tracking-tight">
            Undangan bergabung
          </h1>
          <CardDescription>Seseorang mengundang Anda untuk bergabung ke sebuah project di TestPulse.</CardDescription>
        </CardHeader>

        <CardContent className="grid gap-4">
          <div className="grid gap-1.5 rounded-lg border bg-muted p-4 [overflow-wrap:anywhere]" data-testid="invite-preview">
            <p className="text-sm">
              Anda diundang bergabung ke project <strong className="font-semibold">{invitation.projectName}</strong>{" "}
              sebagai <Badge variant="secondary">{ROLE_LABEL[invitation.role]}</Badge>
            </p>
            <p className="text-sm text-muted-foreground">Berlaku sampai {formatDateTime(invitation.expiresAt)}.</p>
          </div>

          {status === "anonymous" ? (
            <>
              <p className="text-sm text-muted-foreground">Masuk atau daftar dulu untuk menerima undangan ini.</p>
              <Button asChild size="lg" className="w-full">
                <Link to={loginPathFor(invitePath)} data-testid="invite-accept">
                  Masuk untuk menerima
                </Link>
              </Button>
            </>
          ) : (
            <>
              <FormError message={error} />
              {alreadyMember ? (
                <p className="text-center text-sm">
                  <Link
                    to={`/p/${invitation.projectSlug}`}
                    className="rounded-sm font-medium text-link underline underline-offset-4 hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
                  >
                    Buka project
                  </Link>
                </p>
              ) : null}
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={status === "loading" || status === "error" || accepting}
                onClick={() => void accept()}
                data-testid="invite-accept"
              >
                {accepting ? "Memproses…" : "Terima undangan"}
              </Button>
            </>
          )}
        </CardContent>

        {status === "anonymous" ? (
          <CardFooter className="justify-center text-sm text-muted-foreground">
            <p>
              Belum punya akun?{" "}
              <Link
                to={registerPathFor(invitePath)}
                className="rounded-sm font-medium text-link underline underline-offset-4 hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
              >
                Daftar sekarang
              </Link>
            </p>
          </CardFooter>
        ) : null}
      </Card>
    </section>
  );
}
