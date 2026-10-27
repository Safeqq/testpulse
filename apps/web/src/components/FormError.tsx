/** Error umum form. Wadah `role="alert"` selalu ada agar pembaca layar mengumumkan isi yang muncul belakangan. */
export function FormError({ message }: { message: string | null }) {
  return (
    <div
      role="alert"
      className={
        message
          ? "mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive"
          : undefined
      }
      data-testid={message ? "form-error" : undefined}
    >
      {message}
    </div>
  );
}
