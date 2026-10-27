import type { ReactNode } from "react";

/** Judul bagian landing: label kecil beraksen, judul h2, dan penjelasan singkat. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-semibold tracking-wide text-link uppercase">{eyebrow}</p>
      <h2 id={id} className="mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
        {title}
      </h2>
      {children ? <p className="mt-3 text-muted-foreground">{children}</p> : null}
    </div>
  );
}
