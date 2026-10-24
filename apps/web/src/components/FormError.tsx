/** Error umum form. Wadah `role="alert"` selalu ada agar pembaca layar mengumumkan isi yang muncul belakangan. */
export function FormError({ message }: { message: string | null }) {
  return (
    <div role="alert" className={message ? "form-error" : undefined} data-testid={message ? "form-error" : undefined}>
      {message}
    </div>
  );
}
